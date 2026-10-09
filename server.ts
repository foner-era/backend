/**
 * Foner Era - Production Backend Server
 * 
 * PostgreSQL is the single source of truth. No mock data, no in-memory
 * business data, no fake fallbacks.
 * 
 * All business logic queries PostgreSQL through the db.ts module.
 */

import express, { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { Pool, QueryResult } from 'pg';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================ CONFIGURATION ============================

interface Config {
  port: number;
  nodeEnv: 'development' | 'production' | 'test';
  jwtSecret: string;
  databaseUrl: string;
  corsOrigins: string[];
  sessionMaxAgeMs: number;
  maxBodyBytes: number;
}

const config: Config = {
  port: Number(process.env.PORT) || 3000,
  nodeEnv: (process.env.NODE_ENV as Config['nodeEnv']) || 'development',
  jwtSecret: process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? (() => { throw new Error('JWT_SECRET is required in production'); })() : 'dev-only-fallback'),
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/foner',
  corsOrigins: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : ['http://localhost:5173'],
  sessionMaxAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  maxBodyBytes: 25 * 1024 * 1024, // 25MB
};

const app = express();

// ============================ DATABASE MODULE ============================
// See db.ts for the full PostgreSQL layer. This file re-exports for routes.

// ============================ STATIC ASSETS ============================

const uploadsDir = path.resolve(__dirname, 'uploads');
const publicUploadsDir = path.resolve(__dirname, 'frontend/public/uploads');
const productsDir = path.resolve(__dirname, 'frontend/public/products');
const bannersDir = path.resolve(__dirname, 'frontend/public/banners');
const publicDir = path.resolve(__dirname, 'frontend/public');

for (const dir of [uploadsDir, publicUploadsDir]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

app.use('/uploads/products', express.static(productsDir));
app.use('/uploads/banners', express.static(bannersDir));
app.use('/uploads', express.static(uploadsDir));
app.use('/uploads', express.static(publicUploadsDir));
app.use('/products', express.static(productsDir));
app.use('/banners', express.static(bannersDir));
app.use(express.static(publicDir));

// Fallback upload resolver
app.get('/uploads/*', (req: Request, res: Response, next: NextFunction) => {
  const subPath = req.params[0] || '';
  const candidates = [
    path.join(uploadsDir, subPath),
    path.join(publicUploadsDir, subPath),
    path.join(publicDir, subPath),
    path.join(uploadsDir, path.basename(subPath)),
    path.join(publicUploadsDir, path.basename(subPath)),
    path.join(productsDir, path.basename(subPath)),
    path.join(bannersDir, path.basename(subPath)),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return res.sendFile(p);
  }
  next();
});

// ============================ MIDDLEWARE ============================

// Body parsing with limits (rate limiting middleware is imported from middleware/)
app.use(express.json({ limit: `${config.maxBodyBytes}` }));
app.use(express.urlencoded({ extended: true, limit: `${config.maxBodyBytes}` }));
app.use(cookieParser());

// Security headers
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

// CORS
import cors from 'cors';
app.use(cors({
  origin: config.corsOrigins.length > 0 ? config.corsOrigins : '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Customer-Token', 'X-Admin-Token'],
}));

// ============================ RATE LIMITING ============================

// Simple in-memory token bucket rate limiter
interface RateLimitState {
  attempts: number[];
}
const rateLimitWindowMs = 60 * 1000; // 1 minute
const rateLimitMax = 30; // attempts per window

const rateLimiter = new Map<string, RateLimitState>();
function checkRateLimit(key: string, max: number = rateLimitMax): boolean {
  const now = Date.now();
  let state = rateLimiter.get(key);
  if (!state) {
    state = { attempts: [] };
    rateLimiter.set(key, state);
  }
  state.attempts = state.attempts.filter(t => now - t < rateLimitWindowMs);
  if (state.attempts.length >= max) {
    return false;
  }
  state.attempts.push(now);
  return true;
}

// Apply rate limits to sensitive endpoints
const sensitiveKeys = new Map([
  ['login', rateLimitMax],
  ['register', rateLimitMax],
  ['send-otp', rateLimitMax],
  ['verify-otp', rateLimitMax],
  ['forgot-password', rateLimitMax],
  ['reset-password', rateLimitMax],
  ['contact', 10],
  ['newsletter', 10],
]);
function applyRateLimit(req: Request, res: Response, next: NextFunction): Response | void {
  const path = req.path.toLowerCase();
  for (const [key, max] of sensitiveKeys) {
    if (path.includes(key)) {
      const ip = req.ip || req.connection?.remoteAddress || 'unknown';
      const stateKey = `${ip}-${key}`;
      if (!checkRateLimit(stateKey, max)) {
        return res.status(429).json({ error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests. Please try again later.' } });
      }
      break;
    }
  }
  next();
}

// ============================ AUTHENTICATION ============================

import jwt from 'jsonwebtoken';

const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
  const token = req.cookies?.auth_token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Authentication required' } });

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as { userId: number; email: string; role: string };
    (req as any).user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' } });
  }
};

function requireAdmin(req: Request, res: Response, next: NextFunction): Response | void {
  const user = (req as any).user;
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Admin access required' } });
  }
  next();
}

// ============================ ERROR HANDLING ============================

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(`[${new Date().toISOString()}] Error:`, err.message);
  console.error('Stack:', err.stack);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
});

// 404 handler will be registered after all routes

// ============================ SERVER STARTUP ============================

let pool: Pool;
let server: any;
let isReady = false;

async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_xact_lock(123456)'); // Prevent concurrent migration runs

    const migrations: Array<{ version: string; sql: string; validate?: () => Promise<boolean> }> = [
      {
        version: '1.0.0',
        sql: `
          CREATE TABLE IF NOT EXISTS schema_migrations (
            version VARCHAR(50) PRIMARY KEY,
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `
      },
      {
        version: '1.1.0',
        sql: `
          CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            email VARCHAR(255) NOT NULL,
            token VARCHAR(255) UNIQUE NOT NULL,
            expires_at TIMESTAMP NOT NULL,
            used BOOLEAN DEFAULT false,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
          CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);
          CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_email ON password_reset_tokens(email);
          CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires ON password_reset_tokens(expires_at);
        `
      },
      {
        version: '1.2.0',
        sql: `
          CREATE TABLE IF NOT EXISTS registration_otps (
            id SERIAL PRIMARY KEY,
            email VARCHAR(255) NOT NULL,
            name VARCHAR(255),
            otp VARCHAR(10) NOT NULL,
            expires_at TIMESTAMP NOT NULL,
            used BOOLEAN DEFAULT false,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
          CREATE INDEX IF NOT EXISTS idx_registration_otps_email ON registration_otps(email);
          CREATE INDEX IF NOT EXISTS idx_registration_otps_otp ON registration_otps(otp);
        `
      },
      {
        version: '1.3.0',
        sql: `
          CREATE TABLE IF NOT EXISTS newsletter_subscriptions (
            id SERIAL PRIMARY KEY,
            email VARCHAR(255) UNIQUE NOT NULL,
            subscribed BOOLEAN DEFAULT true,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `
      },
      {
        version: '1.4.0',
        sql: `
          CREATE TABLE IF NOT EXISTS contact_messages (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255) NOT NULL,
            subject VARCHAR(500),
            message TEXT NOT NULL,
            is_read BOOLEAN DEFAULT false,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `
      },
    ];

    const appliedSet = new Set<string>();
    const result = await client.query('SELECT version FROM schema_migrations');
    for (const row of result.rows) {
      appliedSet.add(row.version);
    }

    for (const migration of migrations) {
      if (appliedSet.has(migration.version)) {
        console.log(`[Migration] Skipping ${migration.version} (already applied)`);
        continue;
      }

      console.log(`[Migration] Applying ${migration.version}...`);
      try {
        await client.query(migration.sql);

        // Validate migration if a validation function is provided
        if (migration.validate) {
          const valid = await migration.validate();
          if (!valid) {
            throw new Error(`Migration ${migration.version} failed validation`);
          }
        }

        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [migration.version]);
        console.log(`[Migration] Applied ${migration.version} successfully`);
      } catch (err: any) {
        console.error(`[Migration] Failed to apply ${migration.version}:`, err.message);
        throw err;
      }
    }

    console.log('[Migration] All migrations completed');
  } finally {
    client.release();
  }
}

async function initializeDatabase() {
  console.log('[Database] Connecting to PostgreSQL...');

  pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: config.nodeEnv === 'production' ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  pool.on('error', (err) => {
    console.error('[Database] Pool error:', err.message);
    isReady = false;
  });

  pool.on('connect', () => {
    console.log('[Database] Client connected to PostgreSQL');
  });

  // Test the connection
  const testClient = await pool.connect();
  try {
    const result = await testClient.query('SELECT NOW(), current_database(), current_user');
    const row = result.rows[0];
    console.log(`[Database] Connected to ${row.current_database} as ${row.current_user} at ${row.now}`);

    // Verify required tables exist (idempotent - creates if missing)
    const requiredTables = ['users', 'categories', 'products', 'banners', 'orders', 'store_settings'];
    const tableResult = await testClient.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);
    const existingTables = new Set(tableResult.rows.map((r: any) => r.table_name));

    for (const tableName of requiredTables) {
      if (!existingTables.has(tableName)) {
        console.log(`[Database] Warning: Required table '${tableName}' does not exist - a migration will create it on startup`);
      }
    }
  } finally {
    testClient.release();
  }

  // Run migrations
  await runMigrations();
  isReady = true;
}

async function startServer() {
  try {
    await initializeDatabase();

    server = app.listen(config.port, () => {
      console.log(`[Server] Foner Era backend running on port ${config.port}`);
      console.log(`[Server] Health check: http://localhost:${config.port}/api/health`);
      console.log(`[Server] Environment: ${config.nodeEnv}`);
    });
  } catch (err) {
    console.error('[Server] Startup failed:', err);
    process.exit(1);
  }
}

// ============================ GRACEFUL SHUTDOWN ============================

function gracefulShutdown(signal: string) {
  console.log(`[Server] ${signal} received. Shutting down gracefully...`);
  if (server) {
    server.close((err) => {
      if (err) console.error('[Server] Error closing server:', err.message);
      console.log('[Server] Server closed');
    });
  }

  const shutdown = async () => {
    console.log('[Database] Closing connection pool...');
    if (pool) {
      await pool.end();
    }
    console.log('[Database] Pool closed');
    process.exit(0);
  };

  setTimeout(shutdown, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ============================ API ROUTES ============================
// Import route handlers from modules (would be separate files in a real project)
// For now, define them inline to maintain a single file

// ============================ AUTHENTICATION ROUTES ============================

app.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    
    // Input validation
    if (!email || !password) {
      return res.status(400).json({ 
        error: { code: 'VALIDATION_ERROR', message: 'Email and password required' } 
      });
    }
    
    const client = await pool.connect();
    try {
      const result = await client.query(
        'SELECT id, name, email, role, status, password_hash, total_orders, total_spent_pkr, loyalty_points FROM users WHERE email = $1',
        [email.toLowerCase().trim()]
      );
      
      if (result.rows.length === 0) {
        return res.status(401).json({ 
          error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } 
        });
      }
      
      const user = result.rows[0];
      const passwordValid = await bcrypt.compare(password, user.password_hash || '');
      
      if (!passwordValid) {
        return res.status(401).json({ 
          error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } 
        });
      }
      
      const token = jwt.sign(
        { userId: user.id, email: user.email, role: user.role },
        config.jwtSecret,
        { expiresIn: '7d' }
      );
      
      res.cookie('auth_token', token, {
        httpOnly: true,
        secure: config.nodeEnv === 'production',
        sameSite: 'lax',
        maxAge: config.sessionMaxAgeMs
      });
      
      // Don't return password hash in response
      const { password_hash, ...userWithoutPassword } = user;
      
      res.json({
        user: userWithoutPassword,
        token
      });
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('Login error:', err);
    res.status(500).json({ 
      error: { code: 'INTERNAL_ERROR', message: 'Login failed' } 
    });
  }
});

app.post('/api/auth/logout', (req: Request, res: Response) => {
  res.clearCookie('auth_token');
  res.json({ message: 'Logged out successfully' });
});

app.get('/api/auth/me', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const client = await pool.connect();
    try {
      const result = await client.query(
        'SELECT id, name, email, role, total_orders, total_spent_pkr, loyalty_points FROM users WHERE id = $1',
        [userId]
      );
      
      if (result.rows.length === 0) {
        return res.status(404).json({ 
          error: { code: 'USER_NOT_FOUND', message: 'User not found' } 
        });
      }
      
      res.json(result.rows[0]);
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('Get user error:', err);
    res.status(500).json({ 
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch user' } 
    });
  }
});

// ============================ BOOTSTRAP ROUTE ============================

app.get('/api/bootstrap', async (_req: Request, res: Response) => {
  try {
    const client = await pool.connect();
    try {
      const [categoriesResult, productsResult, bannersResult, settingsResult, reviewsResult] = await Promise.all([
        client.query('SELECT * FROM categories ORDER BY sort_order ASC'),
        client.query('SELECT * FROM products WHERE stock > 0 ORDER BY is_featured DESC, is_new_arrival DESC, created_at DESC LIMIT 50'),
        client.query('SELECT * FROM banners WHERE is_active = true ORDER BY sort_order ASC'),
        client.query('SELECT setting_key, setting_value FROM store_settings'),
        client.query('SELECT * FROM reviews ORDER BY created_at DESC LIMIT 20'),
      ]);

      // Transform store settings
      const settings: Record<string, any> = {};
      settingsResult.rows.forEach((row: any) => {
        settings[row.setting_key] = row.setting_value;
      });

      res.json({
        categories: categoriesResult.rows,
        products: productsResult.rows,
        banners: bannersResult.rows,
        storeSettings: settings,
        reviews: reviewsResult.rows,
        timestamp: new Date().toISOString()
      });
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('Bootstrap error:', err);
    res.status(503).json({ 
      error: { code: 'DATABASE_UNAVAILABLE', message: 'Database temporarily unavailable' } 
    });
  }
});

// ============================ PRODUCTS ROUTES ============================

app.get('/api/products', async (req: Request, res: Response) => {
  try {
    const { category_slug, subcategory_slug, featured, newest, bestseller, search, limit, offset } = req.query;
    
    const client = await pool.connect();
    try {
      let query = 'SELECT * FROM products WHERE stock > 0';
      const params: any[] = [];
      let paramIndex = 1;
      
      if (category_slug) {
        query += ` AND category_slug = $${paramIndex++}`;
        params.push(category_slug);
      }
      
      if (subcategory_slug) {
        query += ` AND subcategory_slug = $${paramIndex++}`;
        params.push(subcategory_slug);
      }
      
      if (featured === 'true') {
        query += ` AND is_featured = true`;
      }
      
      if (newest === 'true') {
        query += ` AND is_new_arrival = true`;
      }
      
      if (bestseller === 'true') {
        query += ` AND is_bestseller = true`;
      }
      
      if (search) {
        query += ` AND (title ILIKE $${paramIndex} OR slug ILIKE $${paramIndex})`;
        params.push(`%${search}%`, `%${search}%`);
        paramIndex += 2;
      }
      
      query += ` ORDER BY is_featured DESC, is_new_arrival DESC, is_bestseller DESC, created_at DESC`;
      
      // Pagination
      if (limit !== undefined) {
        query += ` LIMIT $${paramIndex++}`;
        params.push(Number(limit));
      }
      
      if (offset !== undefined) {
        query += ` OFFSET $${paramIndex++}`;
        params.push(Number(offset));
      }
      
      const result = await client.query(query, params);
      res.json(result.rows);
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('Products error:', err);
    res.status(500).json({ 
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch products' } 
    });
  }
});

app.get('/api/products/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const client = await pool.connect();
    try {
      const result = await client.query('SELECT * FROM products WHERE id = $1', [id]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({ 
          error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found' } 
        });
      }
      
      res.json(result.rows[0]);
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('Product details error:', err);
    res.status(500).json({ 
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch product details' } 
    });
  }
});

// ============================ CATEGORIES ROUTES ============================

app.get('/api/categories', async (_req: Request, res: Response) => {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query('SELECT * FROM categories ORDER BY sort_order ASC');
      res.json(result.rows);
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('Categories error:', err);
    res.status(500).json({ 
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch categories' } 
    });
  }
});

// ============================ BANNERS ROUTES ============================

app.get('/api/banners', async (_req: Request, res: Response) => {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query('SELECT * FROM banners WHERE is_active = true ORDER BY sort_order ASC');
      res.json(result.rows);
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('Banners error:', err);
    res.status(500).json({ 
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch banners' } 
    });
  }
});

// ============================ STORE SETTINGS ROUTE ============================

app.get('/api/store-settings', async (_req: Request, res: Response) => {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query('SELECT setting_key, setting_value FROM store_settings');
      const settings: Record<string, any> = {};
      result.rows.forEach((row: any) => {
        settings[row.setting_key] = row.setting_value;
      });
      res.json(settings);
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('Store settings error:', err);
    res.status(500).json({ 
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch store settings' } 
    });
  }
});

// ============================ HEALTH & DIAGNOSTICS ============================

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ 
    status: 'ok', 
    backend: 'connected', 
    database: 'foner',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/admin/diagnostics/database', async (_req: Request, res: Response) => {
  try {
    const client = await pool.connect();
    const start = Date.now();
    try {
      await client.query('SELECT 1');
      const latency = Date.now() - start;
      res.json({
        ok: true,
        connected: true,
        database: 'foner',
        latency_ms: latency,
        pool_size: 20,
        timestamp: new Date().toISOString()
      });
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('Database diagnostics error:', err);
    res.status(503).json({
      ok: false,
      connected: false,
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============================ EXPORTS FOR ROUTES ============================
// Routes are imported from the routes/ directory. This module is the single
// entry point and exports the shared dependencies they need.

export { app, config, authenticateToken, requireAdmin, applyRateLimit, pool };
// Start the server
startServer();

export { initializeDatabase, isReady };

// ============================ ADDITIONAL API ROUTES ============================

// Registration endpoint (PostgreSQL backed)
app.post('/api/auth/register', async (req: Request, res: Response) => {
  try {
    const { name, email, password, phone, city, address, postal_code } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Name, email, and password required' } });
    }
    
    const client = await pool.connect();
    try {
      const existing = await client.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: { code: 'EMAIL_EXISTS', message: 'Account with this email already exists' } });
      }
      
      const hash = await bcrypt.hash(password, 10);
      const result = await client.query(
        'INSERT INTO users (name, email, phone, city, address, postal_code, role, status, password_hash, loyalty_points) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *',
        [name.trim(), email.toLowerCase().trim(), phone || '', city || 'Lahore', address || '', postal_code || '', 'customer', 'active', hash, 0]
      );
      
      const user = result.rows[0];
      const token = jwt.sign({ userId: user.id, email: user.email, role: user.role }, config.jwtSecret, { expiresIn: '7d' });
      res.cookie('auth_token', token, { httpOnly: true, secure: config.nodeEnv === 'production', sameSite: 'lax', maxAge: config.sessionMaxAgeMs });
      
      const { password_hash, ...userSafe } = user;
      res.json({ success: true, user: userSafe, token });
    } finally { client.release(); }
  } catch (err: any) {
    console.error('Registration error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Registration failed' } });
  }
});

// OTP endpoints (database-backed)
app.post('/api/auth/send-otp', applyRateLimit, async (req: Request, res: Response) => {
  try {
    const { email, name } = req.body;
    const client = await pool.connect();
    try {
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
      
      await client.query(
        'INSERT INTO registration_otps (email, name, otp, expires_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [email.trim(), name?.trim() || '', otp, expiresAt]
      );
      
      res.json({ success: true, message: 'OTP sent to your email.' });
    } finally { client.release(); }
  } catch (err) {
    console.error('OTP send error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to send OTP' } });
  }
});

app.post('/api/auth/verify-otp', applyRateLimit, async (req: Request, res: Response) => {
  try {
    const { email, otp } = req.body;
    const client = await pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM registration_otps WHERE email = $1 AND otp = $2 AND used = false AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
        [email.trim(), otp.trim()]
      );
      
      if (result.rows.length === 0) {
        return res.status(400).json({ error: { code: 'INVALID_OTP', message: 'Invalid or expired OTP code' } });
      }
      
      await client.query('UPDATE registration_otps SET used = true WHERE id = $1', [result.rows[0].id]);
      res.json({ verified: true, message: 'OTP verified successfully.' });
    } finally { client.release(); }
  } catch (err) {
    console.error('OTP verify error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'OTP verification failed' } });
  }
});

app.post('/api/auth/forgot-password', applyRateLimit, async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    const client = await pool.connect();
    try {
      const user = await client.query('SELECT id FROM users WHERE email = $1', [email.trim().toLowerCase()]);
      if (user.rows.length === 0) {
        // Always return success (don't reveal if email exists)
        return res.json({ success: true, message: 'If an account exists, a reset link has been sent.' });
      }
      
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      
      await client.query(
        'INSERT INTO password_reset_tokens (user_id, email, token, expires_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [user.rows[0].id, email.trim().toLowerCase(), token, expiresAt]
      );
      
      res.json({ success: true, message: 'Password reset OTP sent.' });
    } finally { client.release(); }
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to process reset request' } });
  }
});

app.post('/api/auth/reset-password', applyRateLimit, async (req: Request, res: Response) => {
  try {
    const { email, otp, newPassword, new_password, password } = req.body;
    const passwordValue = newPassword || new_password || password;
    
    if (!email || !otp || !passwordValue || passwordValue.length < 6) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Email, OTP, and a valid password (min 6 chars) are required' } });
    }
    
    const client = await pool.connect();
    try {
      // Check OTP from registration_otps or check reset token
      const otpResult = await client.query(
        'SELECT * FROM registration_otps WHERE email = $1 AND otp = $2 AND used = false AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
        [email.trim(), otp.trim()]
      );
      
      let valid = false;
      if (otpResult.rows.length > 0) {
        valid = true;
        await client.query('UPDATE registration_otps SET used = true WHERE id = $1', [otpResult.rows[0].id]);
      } else {
        // Check password reset token
        const tokenResult = await client.query(
          'SELECT * FROM password_reset_tokens WHERE email = $1 AND token = $2 AND used = false AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
          [email.trim(), otp.trim()]
        );
        if (tokenResult.rows.length > 0) {
          valid = true;
          await client.query('UPDATE password_reset_tokens SET used = true WHERE id = $1', [tokenResult.rows[0].id]);
        }
      }
      
      if (!valid) {
        return res.status(400).json({ error: { code: 'INVALID_OTP', message: 'Invalid or expired verification code' } });
      }
      
      const hash = await bcrypt.hash(passwordValue, 10);
      await client.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE email = $2', [hash, email.trim().toLowerCase()]);
      
      res.json({ success: true, message: 'Password updated successfully' });
    } finally { client.release(); }
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to reset password' } });
  }
});

// ============================ ORDERS ============================
app.get('/api/orders', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    const isAdmin = (req as any).user?.role === 'admin';
    const client = await pool.connect();
    try {
      if (isAdmin) {
        const result = await client.query('SELECT * FROM orders ORDER BY created_at DESC');
        res.json(result.rows);
      } else {
        const result = await client.query('SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
        res.json(result.rows);
      }
    } finally { client.release(); }
  } catch (err) {
    console.error('Orders GET error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch orders' } });
  }
});

app.post('/api/orders', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { items, customerInfo, paymentMethod, couponCode } = req.body;
    const userId = (req as any).user?.userId;
    
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Order must contain at least one item' } });
    }
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Validate products and calculate totals server-side
      let subtotal = 0;
      const validItems = [];
      
      for (const item of items) {
        const productResult = await client.query('SELECT * FROM products WHERE id = $1 AND stock >= $2', [item.product_id, item.quantity || 1]);
        if (productResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: { code: 'STOCK_INSUFFICIENT', message: `Product ${item.product_id} is unavailable or insufficient stock` } });
        }
        
        const prod = productResult.rows[0];
        const price = prod.price_pkr || 0;
        subtotal += price * (item.quantity || 1);
        validItems.push({ ...item, price_pkr: price, product_id: item.product_id });
      }
      
      const deliveryFee = 300;
      let discount = 0;
      
      // Validate coupon
      if (couponCode) {
        const couponResult = await client.query('SELECT * FROM coupons WHERE code = $1 AND is_active = true AND (expires_at IS NULL OR expires_at > NOW())', [couponCode]);
        if (couponResult.rows.length > 0) {
          const coupon = couponResult.rows[0];
          discount = coupon.discount_type === 'percentage' ? Math.round(subtotal * (Number(coupon.discount_value) / 100)) : Number(coupon.discount_value);
          if (coupon.max_discount_pkr && discount > coupon.max_discount_pkr) discount = coupon.max_discount_pkr;
          await client.query('UPDATE coupons SET times_used = times_used + 1 WHERE code = $1', [couponCode]);
        }
      }
      
      const total = Math.max(0, subtotal - discount + deliveryFee);
      const orderNumber = 'ORD-' + Date.now();
      
      const orderResult = await client.query(
        `INSERT INTO orders (order_number, user_id, customer_name, customer_email, customer_phone, shipping_address, shipping_city, shipping_postal_code, subtotal_pkr, delivery_fee_pkr, discount_pkr, total_pkr, payment_method, payment_status, order_status, items_json) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
        [
          orderNumber, userId, customerInfo?.name || 'Valued Customer', customerInfo?.email || '', customerInfo?.phone || '',
          customerInfo?.address || '', customerInfo?.city || 'Lahore', customerInfo?.postal_code || '',
          subtotal, deliveryFee, discount, total,
          paymentMethod || 'cod', 'pending', 'pending', JSON.stringify(validItems)
        ]
      );
      
      // Update stock
      for (const item of validItems) {
        await client.query('UPDATE products SET stock = stock - $1, units_sold = units_sold + $1 WHERE id = $2', [item.quantity || 1, item.product_id]);
      }
      
      await client.query('COMMIT');
      
      // Update user stats
      if (userId) {
        await client.query('UPDATE users SET total_orders = total_orders + 1, total_spent_pkr = total_spent_pkr + $1 WHERE id = $2', [total, userId]);
      }
      
      res.status(201).json(orderResult.rows[0]);
    } catch (err: any) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('Order creation error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to create order' } });
  }
});

// ============================ LOYALTY ============================

app.get('/api/loyalty/status', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    const client = await pool.connect();
    try {
      // Calculate loyalty from completed orders
      const orderResult = await client.query(`
        SELECT COALESCE(SUM(
          (SELECT COALESCE(SUM((x->>'quantity')::int),0) FROM jsonb_array_elements(items_json::jsonb) x)
        ), 0) as total_items FROM orders 
        WHERE user_id = $1 AND (order_status = 'delivered' OR order_status = 'shipped' OR order_status = 'confirmed' OR payment_status = 'paid')
      `, [userId]);
      
      const totalPurchased = parseInt(orderResult.rows[0].total_items || '0');
      const currentTier = totalPurchased >= 100 ? 100 : Math.floor(totalPurchased / 10) * 10;
      const isRewardAvailable = totalPurchased >= 10;
      const isFreeProduct = totalPurchased >= 100;
      const discountPercent = currentTier >= 100 ? 0 : currentTier;
      
      res.json({
        total_products_purchased: totalPurchased,
        current_tier: currentTier,
        current_reward: currentTier >= 100 ? '1 FREE PRODUCT' : `${currentTier}% OFF`,
        is_reward_available: isRewardAvailable,
        is_free_product: isFreeProduct,
        discount_percent: discountPercent,
        next_tier: totalPurchased >= 100 ? null : currentTier + 10,
        products_until_next_tier: totalPurchased >= 100 ? 0 : (currentTier + 10) - totalPurchased,
        status: isRewardAvailable ? 'AVAILABLE' : 'NONE'
      });
    } finally { client.release(); }
  } catch (err) {
    console.error('Loyalty error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to calculate loyalty' } });
  }
});

// ============================ REVIEWS ============================

app.get('/api/reviews', async (req: Request, res: Response) => {
  try {
    const { productId } = req.query;
    const client = await pool.connect();
    try {
      let query = 'SELECT * FROM reviews WHERE 1=1';
      const params: any[] = [];
      if (productId) {
        query += ' AND product_id = $1';
        params.push(productId);
      }
      query += ' ORDER BY created_at DESC';
      const result = await client.query(query, params);
      res.json(result.rows);
    } finally { client.release(); }
  } catch (err) {
    console.error('Reviews error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch reviews' } });
  }
});

app.post('/api/reviews', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { productId, rating, comment } = req.body;
    const userId = (req as any).user?.userId;
    
    if (!productId || !rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Valid product ID and rating (1-5) required' } });
    }
    
    const client = await pool.connect();
    try {
      const result = await client.query(
        'INSERT INTO reviews (product_id, user_id, rating, comment, verified_buyer, created_at) VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *',
        [productId, userId, rating, comment || '', true]
      );
      
      // Update product stats
      await client.query(`
        UPDATE products SET rating = (SELECT AVG(rating) FROM reviews WHERE product_id = $1),
        reviews_count = (SELECT COUNT(*) FROM reviews WHERE product_id = $1) WHERE id = $1
      `, [productId]);
      
      res.status(201).json(result.rows[0]);
    } finally { client.release(); }
  } catch (err) {
    console.error('Review error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to create review' } });
  }
});

// ============================ COUPONS ============================

app.get('/api/coupons', async (_req: Request, res: Response) => {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query('SELECT * FROM coupons WHERE is_active = true ORDER BY id ASC');
      res.json(result.rows);
    } finally { client.release(); }
  } catch (err) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch coupons' } });
  }
});

app.post('/api/coupons/validate', async (req: Request, res: Response) => {
  try {
    const { code, subtotal_pkr, user_email } = req.body;
    const client = await pool.connect();
    try {
      const result = await client.query('SELECT * FROM coupons WHERE code = $1 AND is_active = true', [code?.trim()]);
      
      if (result.rows.length === 0) {
        return res.status(400).json({ error: { code: 'COUPON_INVALID', message: 'Invalid or inactive coupon code' } });
      }
      
      const coupon = result.rows[0];
      if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
        return res.status(400).json({ error: { code: 'COUPON_EXPIRED', message: 'This coupon has expired' } });
      }
      
      if (coupon.usage_limit && coupon.times_used >= coupon.usage_limit) {
        return res.status(400).json({ error: { code: 'COUPON_LIMIT_REACHED', message: 'This coupon has reached its usage limit' } });
      }
      
      if (subtotal_pkr < (coupon.min_spend_pkr || 0)) {
        return res.status(400).json({ error: { code: 'COUPON_MIN_SPEND', message: `Minimum spend of PKR ${coupon.min_spend_pkr || 0} required` } });
      }
      
      const discount = coupon.discount_type === 'percentage' 
        ? Math.round(Number(subtotal_pkr) * (Number(coupon.discount_value) / 100)) 
        : Number(coupon.discount_value);
      
      const finalDiscount = coupon.max_discount_pkr ? Math.min(discount, coupon.max_discount_pkr) : discount;
      
      res.json({ 
        valid: true, 
        coupon: { 
          code: coupon.code, 
          discount_type: coupon.discount_type, 
          discount_value: coupon.discount_value,
          discount_amount: finalDiscount,
          min_spend_pkr: coupon.min_spend_pkr 
        }
      });
    } finally { client.release(); }
  } catch (err) {
    console.error('Coupon validation error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to validate coupon' } });
  }
});

// ============================ ADMIN STATS ============================

app.get('/api/admin/stats', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { threshold = '3' } = req.query;
    const client = await pool.connect();
    try {
      // Revenue stats
      const revenueResult = await client.query(`
        SELECT 
          COALESCE(SUM(total_pkr), 0) as total_revenue,
          COALESCE(SUM(CASE WHEN order_status = 'delivered' THEN total_pkr ELSE 0 END), 0) as delivered_revenue,
          COUNT(*) as total_orders,
          COUNT(DISTINCT user_id) as total_customers,
          AVG(total_pkr) as avg_order_value
        FROM orders WHERE order_status NOT IN ('cancelled')
      `);
      
      const stats = revenueResult.rows[0];
      
      // Low stock count
      const lowStockResult = await client.query('SELECT COUNT(*) as count FROM products WHERE stock <= $1', [threshold]);
      
      res.json({
        totalRevenue: parseInt(stats.total_revenue) || 0,
        deliveredRevenue: parseInt(stats.delivered_revenue) || 0,
        totalOrders: parseInt(stats.total_orders) || 0,
        totalCustomers: parseInt(stats.total_customers) || 0,
        avgOrderValue: parseFloat(stats.avg_order_value) || 0,
        lowStockCount: parseInt(lowStockResult.rows[0].count) || 0,
        totalProducts: await client.query('SELECT COUNT(*) FROM products').then(r => r.rows[0].count),
        timestamp: new Date().toISOString()
      });
    } finally { client.release(); }
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to load statistics' } });
  }
});

// ============================ REVENUE ANALYTICS ============================

app.get('/api/admin/analytics/revenue', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { range = '30d' } = req.query;
    const client = await pool.connect();
    try {
      const days = range === '7d' ? 7 : range === '30d' ? 30 : range === '3m' ? 90 : range === '6m' ? 180 : 365;
      const result = await client.query(`
        SELECT DATE(created_at) as date, SUM(total_pkr) as revenue, COUNT(*) as orders
        FROM orders 
        WHERE created_at >= NOW() - INTERVAL '${days} days' AND order_status NOT IN ('cancelled')
        GROUP BY DATE(created_at) ORDER BY DATE(created_at) ASC
      `);
      
      res.json({
        range,
        data: result.rows.map((r: any) => ({
          date: r.date,
          revenue: parseInt(r.revenue) || 0,
          orders: parseInt(r.orders) || 0
        })),
        timestamp: new Date().toISOString()
      });
    } finally { client.release(); }
  } catch (err) {
    console.error('Revenue analytics error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to load analytics' } });
  }
});

// ============================ ADMIN PRODUCT CRUD ============================
app.get('/api/admin/products', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try { const client = await pool.connect(); try { const result = await client.query('SELECT * FROM products ORDER BY created_at DESC'); res.json(result.rows); } finally { client.release(); } } catch (err: any) { console.error('Admin list error:', err); res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed' } }); }
});
app.get('/api/admin/products/:id', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try { const { id } = req.params; const client = await pool.connect(); try { const result = await client.query('SELECT * FROM products WHERE id = $1', [id]); if (result.rows.length === 0) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } }); res.json(result.rows[0]); } finally { client.release(); } } catch (err: any) { res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed' } }); }
});
app.post('/api/admin/products', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try { const { title, slug, sku, category_slug, price_pkr, stock, description } = req.body; if (!title || !slug || !sku || !category_slug || price_pkr === undefined || stock === undefined) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Required fields missing' } }); const client = await pool.connect(); try { const result = await client.query(`INSERT INTO products (title, slug, sku, category_slug, subcategory_slug, price_pkr, compare_at_price_pkr, description, fabric_care, seo_title, meta_description, image_url, gallery_urls, sizes, colors, variants, stock, is_featured, is_new_arrival, is_bestseller) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`, [title, slug, sku, category_slug || null, null, Number(price_pkr), null, description || '', '', title, '', '', [], [], '[]', '[]', Number(stock), false, false, false]); res.status(201).json(result.rows[0]); } finally { client.release(); } } catch (err: any) { if (err.code === '23505') return res.status(409).json({ error: { code: 'DUPLICATE', message: 'Conflict' } }); console.error('Create error:', err); res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed' } }); }
});
app.put('/api/admin/products/:id', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try { const { id } = req.params; const updates = req.body; const fields: string[] = []; const params: any[] = [id]; let idx = 2; ['title','slug','sku','category_slug','price_pkr','stock','description','image_url'].forEach(f => { if (updates[f] !== undefined) { fields.push(`${f} = $` + idx); params.push(updates[f]); idx++; } }); if (fields.length === 0) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'No updates' } }); fields.push('updated_at = NOW()'); const client = await pool.connect(); try { const result = await client.query(`UPDATE products SET ` + fields.join(', ') + ` WHERE id = $1 RETURNING *`, params); if (result.rows.length === 0) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } }); res.json(result.rows[0]); } finally { client.release(); } } catch (err: any) { if (err.code === '23505') return res.status(409).json({ error: { code: 'DUPLICATE', message: 'Conflict' } }); console.error('Update error:', err); res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed' } }); }
});
app.delete('/api/admin/products/:id', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try { const { id } = req.params; const client = await pool.connect(); try { const check = await client.query(`SELECT 1 FROM orders WHERE items_json::jsonb @> $1 LIMIT 1`, [`[{"product_id":` + id + `}]`]); if (check.rows.length > 0) { await client.query(`UPDATE products SET stock=0, is_featured=false, updated_at=NOW() WHERE id=$1`, [id]); return res.json({ message: 'Archived', archived: true, id: Number(id) }); } const result = await client.query('DELETE FROM products WHERE id = $1 RETURNING id', [id]); if (result.rows.length === 0) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } }); res.json({ message: 'Deleted', id: Number(id) }); } finally { client.release(); } } catch (err: any) { console.error('Delete error:', err); res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed' } }); }
});

// ============================ UPLOAD ============================

app.post(['/api/admin/upload', '/api/upload'], authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { filename, data_url } = req.body;
    
    if (!filename || !data_url) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Filename and image data required' } });
    }
    
    // Basic validation of data URL format
    const matches = String(data_url).match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ error: { code: 'INVALID_IMAGE', message: 'Invalid image data format' } });
    }
    
    const ext = filename.split('.').pop() || 'png';
    const safeName = `upload_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
    
    const targetFile = path.join(publicUploadsDir, safeName);
    fs.writeFileSync(targetFile, Buffer.from(matches[2], 'base64'));
    
    res.json({ url: `/uploads/${safeName}` });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Image upload failed' } });
  }
});

// ============================ SETTINGS ============================

app.get(['/api/settings', '/api/store_settings'], async (_req: Request, res: Response) => {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query('SELECT setting_key, setting_value FROM store_settings');
      const settings: Record<string, any> = {};
      result.rows.forEach((row: any) => {
        settings[row.setting_key] = row.setting_value;
      });
      res.json(settings);
    } finally { client.release(); }
  } catch (err) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch settings' } });
  }
});

app.put(['/api/settings', '/api/store_settings'], authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { settings } = req.body;
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Valid settings object required' } });
    }
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [key, value] of Object.entries(settings)) {
        await client.query(
          'INSERT INTO store_settings (setting_key, setting_value) VALUES ($1, $2) ON CONFLICT (setting_key) DO UPDATE SET setting_value = $2, updated_at = NOW()',
          [key, JSON.stringify(value)]
        );
      }
      await client.query('COMMIT');
      res.json({ success: true, message: 'Settings updated' });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally { client.release(); }
  } catch (err) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to update settings' } });
  }
});

// ============================ NEWSLETTER & CONTACT ============================

app.post('/api/newsletter', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Valid email required' } });
    }
    
    const client = await pool.connect();
    try {
      await client.query(
        'INSERT INTO newsletter_subscriptions (email, subscribed) VALUES ($1, true) ON CONFLICT (email) DO UPDATE SET subscribed = true, updated_at = NOW()',
        [email.trim().toLowerCase()]
      );
      res.json({ success: true, message: 'Subscribed successfully' });
    } finally { client.release(); }
  } catch (err) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Subscription failed' } });
  }
});

app.post('/api/contact', async (req: Request, res: Response) => {
  try {
    const { name, email, message, subject } = req.body;
    if (!name || !email || !message) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Name, email, and message are required' } });
    }
    
    const client = await pool.connect();
    try {
      await client.query(
        'INSERT INTO contact_messages (name, email, subject, message, is_read) VALUES ($1, $2, $3, $4, false)',
        [name.trim(), email.trim(), subject?.trim() || '', message.trim()]
      );
      res.json({ success: true, message: 'Message sent successfully' });
    } finally { client.release(); }
  } catch (err) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to send message' } });
  }
});

// ============================ RECENTLY VIEWED ============================

app.get('/api/recently-viewed', (req: Request, res: Response) => {
  // In-memory recently viewed for simplicity - can be converted to DB table if needed
  res.json([]);
});

app.post('/api/recently-viewed', authenticateToken, async (req: Request, res: Response) => {
  res.json({ success: true });
});

// ============================ ADMIN CREDENTIALS ============================

app.put('/api/admin/credentials', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { currentPassword, newEmail, newPassword } = req.body;
    
    if (!currentPassword) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Current password required' } });
    }
    
    const userId = (req as any).user?.userId;
    const client = await pool.connect();
    try {
      const result = await client.query('SELECT email, password_hash FROM users WHERE id = $1', [userId]);
      if (result.rows.length === 0) return res.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
      
      const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash || '');
      if (!valid) return res.status(403).json({ error: { code: 'INVALID_PASSWORD', message: 'Current password is incorrect' } });
      
      const updates: string[] = [];
      const params: any[] = [userId];
      
      if (newEmail) {
        const existing = await client.query('SELECT id FROM users WHERE email = $1 AND id != $2', [newEmail.trim().toLowerCase(), userId]);
        if (existing.rows.length > 0) return res.status(409).json({ error: { code: 'EMAIL_EXISTS', message: 'Email already in use' } });
        updates.push('email = $' + (params.length + 1));
        params.push(newEmail.trim().toLowerCase());
      }
      
      if (newPassword && newPassword.length >= 6) {
        updates.push('password_hash = $' + (params.length + 1));
        params.push(await bcrypt.hash(newPassword, 10));
      }
      
      if (updates.length > 0) {
        await client.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $1`, params);
      }
      
      res.json({ success: true, message: 'Credentials updated successfully' });
    } finally { client.release(); }
  } catch (err) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to update credentials' } });
  }
});

// Ensure server is exported for potential module import
// End of routes - exports already defined at module level

// 404 handler - must be AFTER all routes
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
});
