const User = require('../models/user');

async function authMiddleware(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/auth');
  }

  try {
    const user = await User.findByInstagramId(req.session.userId);
    
    if (!user) {
      return res.redirect('/auth');
    }

    // Check if token needs refresh (24 hours before expiry)
    const tokenExpiresAt = new Date(user.token_expires_at);
    const refreshThreshold = new Date(Date.now() + (24 * 60 * 60 * 1000));

    if (tokenExpiresAt <= refreshThreshold) {
      const newToken = await refreshAccessToken(user.access_token);
      await User.updateToken(user.instagram_user_id, newToken);
      user.access_token = newToken.access_token;
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.redirect('/auth');
  }
}

module.exports = authMiddleware;
