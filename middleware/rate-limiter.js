// rate-limiter.js
const Redis = require('redis');
const util = require('util');
const dotenv = require('dotenv');
dotenv.config();

class RateLimiter {
  constructor() {
    this.redisClient = Redis.createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });
    
    // Promisify Redis commands
    this.redisGet = util.promisify(this.redisClient.get).bind(this.redisClient);
    this.redisSetEx = util.promisify(this.redisClient.setex).bind(this.redisClient);
    this.redisIncr = util.promisify(this.redisClient.incr).bind(this.redisClient);
    this.redisTtl = util.promisify(this.redisClient.ttl).bind(this.redisClient);
  }

  generateKey(type, identifier) {
    const hour = Math.floor(Date.now() / 3600000); // Current hour timestamp
    return `ratelimit:${type}:${identifier}:${hour}`;
  }

  async checkRateLimit({ ip, userId, limit = 200, windowSeconds = 3600 }) {
    try {
      // Create separate keys for IP and user-based limiting
      const ipKey = this.generateKey('ip', ip);
      const userKey = userId ? this.generateKey('user', userId) : null;

      // Check IP-based limits
      const ipCount = await this.redisIncr(ipKey);
      if (ipCount === 1) {
        await this.redisSetEx(ipKey, windowSeconds, 1);
      }

      // Check user-based limits if userId is provided
      let userCount = 0;
      if (userKey) {
        userCount = await this.redisIncr(userKey);
        if (userCount === 1) {
          await this.redisSetEx(userKey, windowSeconds, 1);
        }
      }

      // Get TTL (time until reset) for both limits
      const ipTtl = await this.redisTtl(ipKey);
      const userTtl = userKey ? await this.redisTtl(userKey) : 0;

      // Use the higher count between IP and user limits
      const currentCount = Math.max(ipCount, userCount);

      // Calculate remaining requests
      const remaining = Math.max(0, limit - currentCount);
      
      // Return rate limit info
      return {
        isAllowed: currentCount <= limit,
        remaining,
        resetIn: Math.max(ipTtl, userTtl),
        total: limit,
        current: currentCount
      };
    } catch (error) {
      console.error('Rate limiter error:', error);
      // In case of Redis failure, default to allowing the request
      return {
        isAllowed: true,
        remaining: 1,
        resetIn: 3600,
        total: limit,
        current: 0
      };
    }
  }

  // Middleware for Express
  middleware(options = {}) {
    return async (req, res, next) => {
      const ip = req.ip;
      const userId = req.user?.id; // Assuming you have user info in req.user
      
      const rateLimitInfo = await this.checkRateLimit({
        ip,
        userId,
        limit: options.limit,
        windowSeconds: options.windowSeconds
      });

      // Set rate limit headers
      res.set({
        'X-RateLimit-Limit': rateLimitInfo.total,
        'X-RateLimit-Remaining': rateLimitInfo.remaining,
        'X-RateLimit-Reset': rateLimitInfo.resetIn
      });

      if (!rateLimitInfo.isAllowed) {
        return res.status(429).json({
          error: 'Too Many Requests',
          resetIn: rateLimitInfo.resetIn
        });
      }

      next();
    };
  }
}

module.exports = RateLimiter;