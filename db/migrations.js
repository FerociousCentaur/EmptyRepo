const db = require('./config');

async function createTables() {
  // Users table
  const usersExists = await db.schema.hasTable('users');
  if (!usersExists) {
    await db.schema.createTable('users', table => {
      table.increments('id').primary();
      table.string('instagram_user_id').unique();
      table.string('username');
      table.string('access_token');
      table.datetime('token_expires_at');
      table.timestamps(true, true);
    });
  }

  // Posts table
  const postsExists = await db.schema.hasTable('posts');
  if (!postsExists) {
    await db.schema.createTable('posts', table => {
      table.increments('id').primary();
      table.string('instagram_post_id').unique();
      table.string('instagram_user_id');
      table.string('caption');
      table.string('media_type');
      table.datetime('posted_at');
      table.timestamps(true, true);
    });
  }

  // Media items table
  const mediaItemsExists = await db.schema.hasTable('media_items');
  if (!mediaItemsExists) {
    await db.schema.createTable('media_items', table => {
      table.increments('id').primary();
      table.integer('post_id').references('id').inTable('posts').onDelete('CASCADE');
      table.string('media_url');
      table.string('media_type');
      table.integer('position');
      table.string('thumbnail_url');
      table.timestamps(true, true);
    });
  }
}

module.exports = { createTables };