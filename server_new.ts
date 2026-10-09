import express, { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'foner_secret_key_2026';

// Middleware
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(cookieParser());

// Security headers
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Static files
const uploadsDir = path.resolve(__dirname, 'uploads');
const publicUploadsDir = path.resolve(__dirname, 'frontend/public/uploads');
const productsDir = path.resolve(__dirname, 'frontend/public/products');
const bannersDir = path.resolve(__dirname, 'frontend/public/banners');
const publicDir = path.resolve(__dirname, 'frontend/public');

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(publicUploadsDir)) fs.mkdirSync(publicUploadsDir, { recursive: true });

app.use('/uploads/products', express.static(productsDir));
app.use('/uploads/banners', express.static(bannersDir));
app.use('/uploads', express.static(uploadsDir));
app.use('/uploads', express.static(publicUploadsDir));
app.use('/products', express.static(productsDir));
app.use('/banners', express.static(bannersDir));
app.use(express.static(publicDir));

// PostgreSQL setup
const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/foner';
let pool: Pool;

async function initializeDatabase() {
  pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 20,
  });
  pool.on('error', (err) => console.error('[PostgreSQL] Pool error:', err));
  pool.on('connect', () => console.log('[PostgreSQL] Connected to database'));

  // Test connection
  const client = await pool.connect();
  await client.query('SELECT 1');
  client.release();

  // Create tables if missing
  await createTables();
  console.log('[PostgreSQL] Database ready');
}

async function createTables() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'customer',
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        password_hash TEXT,
        total_orders INTEGER DEFAULT 0,
        total_spent_pkr INTEGER DEFAULT 0,
        loyalty_points INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('[PostgreSQL] Created users table');
  } finally { client.release(); }
}

async function getDbClient() {
  if (!pool) throw new Error('Database not connected');
  return await pool.connect();
}

// JWT auth middleware
const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
  const token = req.cookies?.auth_token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token required' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    (req as any).user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Auth routes
app.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    const client = await getDbClient();
    try {
      const result = await client.query('SELECT * FROM users WHERE email = $1', [email]);
      if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

      const user = result.rows[0];
      const valid = await bcrypt.compare(password, user.password_hash || '');
      if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

      const token = jwt.sign(
        { userId: user.id, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.cookie('auth_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });

      res.json({
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          total_orders: user.total_orders,
          total_spent_pkr: user.total_spent_pkr,
          loyalty_points: user.loyalty_points
        },
        token
      });
    } finally { client.release(); }
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/logout', (req: Request, res: Response) => {
  res.clearCookie('auth_token');
  res.json({ message: 'Logged out successfully' });
});

app.get('/api/auth/me', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const client = await getDbClient();
    try {
      const result = await client.query(
        'SELECT id, name, email, role, total_orders, total_spent_pkr, loyalty_points FROM users WHERE id = $1',
        [userId]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
      res.json(result.rows[0]);
    } finally { client.release(); }
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API routes - all use PostgreSQL
app.get('/api/bootstrap', async (_req: Request, res: Response) => {
  try {
    const client = await getDbClient();
    try {
      const [categories, products, banners, settings] = await Promise.all([
        client.query('SELECT * FROM categories ORDER BY sort_order ASC'),
        client.query('SELECT * FROM products WHERE stock > 0 ORDER BY is_featured DESC, created_at DESC LIMIT 50'),
        client.query('SELECT * FROM banners WHERE is_active = true ORDER BY sort_order ASC'),
        client.query('SELECT setting_key, setting_value FROM store_settings')
      ]);

      const settingsObj: Record<string, any> = {};
      settings.rows.forEach(row => {
        settingsObj[row.setting_key] = row.setting_value;
      });

      res.json({
        categories: categories.rows,
        products: products.rows,
        banners: banners.rows,
        storeSettings: settingsObj,
        timestamp: new Date().toISOString()
      });
    } finally { client.release(); }
  } catch (err) {
    console.error('Bootstrap error:', err);
    res.status(500).json({ error: 'Database unavailable' });
  }
});

// Health and diagnostic endpoints
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', backend: 'connected', timestamp: new Date().toISOString() });
});

app.get('/api/admin/diagnostics/database', async (_req: Request, res: Response) => {
  try {
    const client = await getDbClient();
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
    } finally { client.release(); }
  } catch (err) {
    console.error('Database diagnostics error:', err);
    res.status(503).json({
      ok: false,
      connected: false,
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Placeholder for remaining routes
app.get('/api/store-settings', (_req: Request, res: Response) => {
  res.json({}); // Implement PostgreSQL query
});

app.post('/api/orders', authenticateToken, async (req: Request, res: Response) => {
  // Placeholder for order creation
  res.status(501).json({ error: 'Order creation not yet implemented' });
});

// Catch-all for undefined routes
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

async function startServer() {
  try {
    await initializeDatabase();
    app.listen(PORT, () => {
      console.log(`[Server] Backend running on port ${PORT}`);
      console.log(`[Server] Health check: http://localhost:${PORT}/api/health`);
    });
  } catch (err) {
    console.error('[Server] Startup failed:', err);
    process.exit(1);
  }
}

startServer();