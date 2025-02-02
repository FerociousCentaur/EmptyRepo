const db = require('../db/config');

class Post {
  static async create(postData, mediaItems) {
    const trx = await db.transaction();
    
    try {
      const [postId] = await trx('posts').insert(postData);
      
      const mediaItemsWithPostId = mediaItems.map((item, index) => ({
        ...item,
        post_id: postId,
        position: index
      }));
      
      await trx('media_items').insert(mediaItemsWithPostId);
      
      await trx.commit();
      return postId;
    } catch (error) {
      await trx.rollback();
      throw error;
    }
  }

  static async findByDateRange(userId, startDate, endDate) {
    const posts = await db('posts')
      .where('instagram_user_id', userId)
      .whereBetween('posted_at', [startDate, endDate])
      .orderBy('posted_at', 'desc');

    return await this.attachMediaItems(posts);
  }

  static async findAll(userId) {
    const posts = await db('posts')
      .where('instagram_user_id', userId)
      .orderBy('posted_at', 'desc');

    return await this.attachMediaItems(posts);
  }

  static async attachMediaItems(posts) {
    const postIds = posts.map(post => post.id);
    const mediaItems = await db('media_items')
      .whereIn('post_id', postIds)
      .orderBy(['post_id', 'position']);

    return posts.map(post => ({
      ...post,
      media_items: mediaItems.filter(item => item.post_id === post.id)
    }));
  }
}

module.exports = Post;