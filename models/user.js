const db = require('../db/config');

class User {
  static async findByInstagramId(instagramUserId) {
    return await db('users').where('instagram_user_id', instagramUserId).first();
  }

  static async createOrUpdate(userData) {
    const existing = await this.findByInstagramId(userData.instagram_user_id);
    
    if (existing) {
      await db('users')
        .where('instagram_user_id', userData.instagram_user_id)
        .update(userData);
      return await this.findByInstagramId(userData.instagram_user_id);
    } else {
      await db('users').insert(userData);
      return await this.findByInstagramId(userData.instagram_user_id);
    }
  }

  static async updateToken(instagramUserId, tokenData) {
    return await db('users')
      .where('instagram_user_id', instagramUserId)
      .update({
        access_token: tokenData.access_token,
        token_expires_at: new Date(Date.now() + (tokenData.expires_in * 1000))
      });
  }
}

module.exports = User;