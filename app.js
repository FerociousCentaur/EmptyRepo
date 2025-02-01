const express = require('express');
const session = require('express-session');
const multer = require('multer');
const fetch = require('node-fetch');
const FormData = require('form-data');
const dotenv = require('dotenv');
const path = require('path');

const db = require('./db/config');
const { createTables } = require('./db/migrations');
const User = require('./models/user');
const Post = require('./models/post');
const authMiddleware = require('./middleware/auth');

dotenv.config();

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
}));

// Initialize database
createTables().catch(console.error);

// Instagram API Configuration
const INSTAGRAM_AUTH_URL = 'https://api.instagram.com/oauth/authorize';
const INSTAGRAM_TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
const GRAPH_API_URL = 'https://graph.instagram.com';
const REDIRECT_URI = `http://localhost:${process.env.PORT}/auth/callback`;

// Instagram API Helper Functions
const getAccessToken = async (code) => {
    const params = new URLSearchParams();
    params.append('client_id', process.env.INSTAGRAM_CLIENT_ID);
    params.append('client_secret', process.env.INSTAGRAM_CLIENT_SECRET);
    params.append('grant_type', 'authorization_code');
    params.append('redirect_uri', REDIRECT_URI);
    params.append('code', code);

    const response = await fetch(INSTAGRAM_TOKEN_URL, {
        method: 'POST',
        body: params
    });
    return response.json();
};

const getLongLivedToken = async (shortLivedToken) => {
    const url = `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${process.env.INSTAGRAM_CLIENT_SECRET}&access_token=${shortLivedToken}`;
    const response = await fetch(url);
    return response.json();
};

const refreshAccessToken = async (oldToken) => {
    const url = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${oldToken}`;
    const response = await fetch(url);
    return response.json();
};

const getUserProfile = async (accessToken) => {
    const response = await fetch(`${GRAPH_API_URL}/me?fields=id,username&access_token=${accessToken}`);
    return response.json();
};

const createMediaContainer = async (accessToken, mediaUrls, caption) => {
    if (mediaUrls.length === 1) {
        // Single media post
        const params = new URLSearchParams();
        params.append('image_url', mediaUrls[0]);
        params.append('caption', caption);
        params.append('access_token', accessToken);

        const response = await fetch(`${GRAPH_API_URL}/me/media`, {
            method: 'POST',
            body: params
        });
        return response.json();
    } else {
        // Carousel post
        const childrenContainers = await Promise.all(mediaUrls.map(async (url) => {
            const params = new URLSearchParams();
            params.append('image_url', url);
            params.append('is_carousel_item', 'true');
            params.append('access_token', accessToken);

            const response = await fetch(`${GRAPH_API_URL}/me/media`, {
                method: 'POST',
                body: params
            });
            const data = await response.json();
            return data.id;
        }));

        const params = new URLSearchParams();
        params.append('caption', caption);
        params.append('media_type', 'CAROUSEL');
        params.append('children', childrenContainers.join(','));
        params.append('access_token', accessToken);

        const response = await fetch(`${GRAPH_API_URL}/me/media`, {
            method: 'POST',
            body: params
        });
        return response.json();
    }
};

const publishMedia = async (accessToken, creationId) => {
    const url = `${GRAPH_API_URL}/me/media_publish`;
    const params = new URLSearchParams();
    params.append('creation_id', creationId);
    params.append('access_token', accessToken);

    const response = await fetch(url, {
        method: 'POST',
        body: params
    });
    return response.json();
};

// Routes
app.get('/', (req, res) => {
    res.send(`
        <h1>Instagram Integration</h1>
        <a href="/auth">Connect with Instagram</a>
    `);
});

app.get('/auth', (req, res) => {
    const authUrl = `${INSTAGRAM_AUTH_URL}?client_id=${process.env.INSTAGRAM_CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=user_profile,user_media&response_type=code`;
    res.redirect(authUrl);
});

app.get('/auth/callback', async (req, res) => {
    try {
        const { code } = req.query;
        const tokenData = await getAccessToken(code);
        const longLivedTokenData = await getLongLivedToken(tokenData.access_token);
        
        const profile = await fetch(
            `${GRAPH_API_URL}/me?fields=id,username&access_token=${longLivedTokenData.access_token}`
        ).then(res => res.json());

        await User.createOrUpdate({
            instagram_user_id: profile.id,
            username: profile.username,
            access_token: longLivedTokenData.access_token,
            token_expires_at: new Date(Date.now() + (longLivedTokenData.expires_in * 1000))
        });

        req.session.userId = profile.id;
        res.redirect('/dashboard');
    } catch (error) {
        res.status(500).send(`Authentication error: ${error.message}`);
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.get('/dashboard', authMiddleware, async (req, res) => {
    try {
        const profile = await getUserProfile(req.user.access_token);
        const posts = await Post.findAll(req.user.instagram_user_id);
        
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    .media-grid {
                        display: grid;
                        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
                        gap: 20px;
                        padding: 20px;
                    }
                    .post-card {
                        border: 1px solid #ccc;
                        padding: 15px;
                        border-radius: 8px;
                    }
                    .carousel {
                        display: flex;
                        overflow-x: auto;
                        gap: 10px;
                        padding: 10px 0;
                    }
                    .carousel img {
                        max-width: 300px;
                        height: auto;
                    }
                </style>
            </head>
            <body>
                <h1>Dashboard</h1>
                <div style="text-align: right;">
                    <p>Logged in as: ${req.user.username}</p>
                    <a href="/logout">Logout</a>
                </div>
                
                <h2>Create Post:</h2>
                <form action="/create_post" method="post">
                    <input type="text" name="caption" placeholder="Caption" required><br>
                    <div id="mediaUrls">
                        <input type="url" name="mediaUrls[]" placeholder="Media URL" required><br>
                    </div>
                    <button type="button" onclick="addMediaInput()">Add Another Media// Continuing app.js from the previous dashboard route...

                    </div>
                    <button type="button" onclick="addMediaInput()">Add Another Media URL</button>
                    <input type="submit" value="Create Post">
                </form>

                <h2>Fetch Posts by Date Range:</h2>
                <form action="/fetch_posts" method="get">
                    <input type="date" name="startDate" required>
                    <input type="date" name="endDate" required>
                    <input type="submit" value="Fetch Posts">
                </form>

                <h2>Saved Posts:</h2>
                <div class="media-grid">
                    ${posts.map(post => `
                        <div class="post-card">
                            <p><strong>Posted:</strong> ${new Date(post.posted_at).toLocaleString()}</p>
                            <p><strong>Caption:</strong> ${post.caption || 'No caption'}</p>
                            ${post.media_type === 'carousel_album' ? `
                                <div class="carousel">
                                    ${post.media_items.map(item => `
                                        ${item.media_type === 'video' ? `
                                            <video controls width="300">
                                                <source src="${item.media_url}" type="video/mp4">
                                                Your browser does not support the video tag.
                                            </video>
                                        ` : `
                                            <img src="${item.media_url}" alt="Post media">
                                        `}
                                    `).join('')}
                                </div>
                            ` : `
                                ${post.media_items[0].media_type === 'video' ? `
                                    <video controls width="300">
                                        <source src="${post.media_items[0].media_url}" type="video/mp4">
                                        Your browser does not support the video tag.
                                    </video>
                                ` : `
                                    <img src="${post.media_items[0].media_url}" alt="Post media" style="max-width: 100%;">
                                `}
                            `}
                        </div>
                    `).join('')}
                </div>

                <script>
                    function addMediaInput() {
                        const div = document.getElementById('mediaUrls');
                        const input = document.createElement('input');
                        input.type = 'url';
                        input.name = 'mediaUrls[]';
                        input.placeholder = 'Media URL';
                        input.required = true;
                        div.appendChild(input);
                        div.appendChild(document.createElement('br'));
                    }
                </script>
            </body>
            </html>
        `);
    } catch (error) {
        res.status(500).send(`Error fetching data: ${error.message}`);
    }
});

app.get('/fetch_posts', authMiddleware, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const response = await fetch(
            `${GRAPH_API_URL}/me/media?fields=id,caption,media_type,media_url,thumbnail_url,children{media_type,media_url,thumbnail_url},timestamp&access_token=${req.user.access_token}`
        );
        const data = await response.json();

        // Filter posts by date range
        for (const post of data.data) {
            const postDate = new Date(post.timestamp);
            if (postDate >= new Date(startDate) && postDate <= new Date(endDate)) {
                let mediaItems = [];
                
                if (post.media_type === 'carousel_album' && post.children) {
                    mediaItems = post.children.data.map((child, index) => ({
                        media_url: child.media_url,
                        media_type: child.media_type.toLowerCase(),
                        thumbnail_url: child.thumbnail_url,
                        position: index
                    }));
                } else {
                    mediaItems = [{
                        media_url: post.media_url,
                        media_type: post.media_type.toLowerCase(),
                        thumbnail_url: post.thumbnail_url,
                        position: 0
                    }];
                }

                await Post.create({
                    instagram_post_id: post.id,
                    instagram_user_id: req.user.instagram_user_id,
                    caption: post.caption,
                    media_type: post.media_type.toLowerCase(),
                    posted_at: post.timestamp
                }, mediaItems);
            }
        }

        res.redirect('/dashboard');
    } catch (error) {
        res.status(500).send(`Error fetching posts: ${error.message}`);
    }
});

app.post('/create_post', authMiddleware, async (req, res) => {
    try {
        const { caption, mediaUrls } = req.body;
        const urls = Array.isArray(mediaUrls) ? mediaUrls : [mediaUrls];

        // Create media container
        const containerResponse = await createMediaContainer(
            req.user.access_token,
            urls,
            caption
        );

        if (!containerResponse.id) {
            throw new Error('Failed to create media container');
        }

        // Publish the media
        const publishResponse = await publishMedia(
            req.user.access_token,
            containerResponse.id
        );

        if (publishResponse.id) {
            // Get the published post details
            const postDetailsResponse = await fetch(
                `${GRAPH_API_URL}/${publishResponse.id}?fields=id,caption,media_type,media_url,thumbnail_url,children{media_type,media_url,thumbnail_url}&access_token=${req.user.access_token}`
            );
            const postDetails = await postDetailsResponse.json();

            // Prepare media items
            let mediaItems = [];
            if (postDetails.media_type === 'carousel_album' && postDetails.children) {
                mediaItems = postDetails.children.data.map((child, index) => ({
                    media_url: child.media_url,
                    media_type: child.media_type.toLowerCase(),
                    thumbnail_url: child.thumbnail_url,
                    position: index
                }));
            } else {
                mediaItems = [{
                    media_url: postDetails.media_url,
                    media_type: postDetails.media_type.toLowerCase(),
                    thumbnail_url: postDetails.thumbnail_url,
                    position: 0
                }];
            }

            // Save to database
            await Post.create({
                instagram_post_id: postDetails.id,
                instagram_user_id: req.user.instagram_user_id,
                caption: caption,
                media_type: postDetails.media_type.toLowerCase(),
                posted_at: new Date()
            }, mediaItems);

            res.redirect('/dashboard');
        } else {
            throw new Error('Failed to publish media');
        }
    } catch (error) {
        res.status(500).send(`Error creating post: ${error.message}`);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});