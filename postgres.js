const fs = require('fs');
const content = fs.readFileSync('/home/hell/Downloads/web/backend/server.ts', 'utf-8');

// The complete new PostgreSQL implementation
const newContent = `//===========================================\n// POSTGRESQL DATABASE CONNECTION\n// ==========================================\nconst databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/foner';\n\nlet pool = null;\n\nasync function initializeDatabase() {\n  try {\n    const { Pool } = await import('pg');\n    pool = new Pool({\n      connectionString: databaseUrl,\n      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,\n      max: 20,\n      idleTimeoutMillis: 30000,\n      connectionTimeoutMillis: 5000,\n    });\n\n    pool.on('error', (err) => {\n      console.error('[PostgreSQL] Pool error:', err);\n    });\n\n    pool.on('connect', () => {\n      console.log('[PostgreSQL] Client connected to database');\n    });\n\n    console.log('[PostgreSQL] Attempting connection to', databaseUrl.replace(/\\/\\/[^:]+:[^@]+@/, '//****:****@'));\n\n    const client = await pool.connect();\n    await client.query('SELECT 1');\n    client.release();\n\n    await createTables();\n    await seedData();\n\n    console.log('[PostgreSQL] Database initialization completed successfully');\n  } catch (err) {\n    console.error('[PostgreSQL] Database initialization failed:', err);\n    throw new Error('PostgreSQL connection failed: ' + err.message + '. Cannot start server without database.');\n  }\n}\n\nasync function createTables() {\n  const client = await pool.connect();\n  try {\n    const sql = \\\`CREATE TABLE IF NOT EXISTS users (\n      id SERIAL PRIMARY KEY,\n      name VARCHAR(255) NOT NULL,\n      email VARCHAR(255) UNIQUE NOT NULL,\n      phone VARCHAR(50),\n      city VARCHAR(100),\n      address TEXT,\n      postal_code VARCHAR(20),\n      role VARCHAR(20) NOT NULL DEFAULT 'customer' CHECK (role IN ('admin', 'manager', 'editor', 'customer')),\n      status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),\n      avatar_url TEXT DEFAULT '',\n      total_orders INTEGER DEFAULT 0,\n      total_spent_pkr INTEGER DEFAULT 0,\n      loyalty_points INTEGER DEFAULT 0,\n      password_hash TEXT,\n      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n    );\n    \n    CREATE TABLE IF NOT EXISTS categories (\n      id SERIAL PRIMARY KEY,\n      name VARCHAR(255) NOT NULL,\n      slug VARCHAR(255) UNIQUE NOT NULL,\n      description TEXT,\n      image_url TEXT,\n      accent_color VARCHAR(10) DEFAULT '#631828',\n      product_count INTEGER DEFAULT 0,\n      featured BOOLEAN DEFAULT false,\n      sort_order INTEGER DEFAULT 0,\n      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n    );\n    \n    CREATE TABLE IF NOT EXISTS subcategories (\n      id SERIAL PRIMARY KEY,\n      name VARCHAR(255) NOT NULL,\n      slug VARCHAR(255) UNIQUE NOT NULL,\n      parent_category_slug VARCHAR(255) REFERENCES categories(slug) ON DELETE SET NULL,\n      description TEXT,\n      image_url TEXT,\n      featured BOOLEAN DEFAULT false,\n      sort_order INTEGER DEFAULT 0,\n      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n    );\n    \n    CREATE TABLE IF NOT EXISTS products (\n      id SERIAL PRIMARY KEY,\n      title VARCHAR(500) NOT NULL,\n      slug VARCHAR(500) UNIQUE NOT NULL,\n      sku VARCHAR(100) UNIQUE NOT NULL,\n      category_slug VARCHAR(255) REFERENCES categories(slug) ON DELETE SET NULL,\n      subcategory_slug VARCHAR(255) REFERENCES subcategories(slug) ON DELETE SET NULL,\n      price_pkr INTEGER NOT NULL DEFAULT 0,\n      compare_at_price_pkr INTEGER,\n      description TEXT,\n      fabric_care TEXT,\n      seo_title VARCHAR(500),\n      meta_description TEXT,\n      image_url TEXT,\n      gallery_urls TEXT[] DEFAULT '{}',\n      sizes TEXT[] DEFAULT '{}',\n      colors JSONB DEFAULT '[]',\n      variants JSONB DEFAULT '[]',\n      stock INTEGER DEFAULT 0,\n      is_featured BOOLEAN DEFAULT false,\n      is_new_arrival BOOLEAN DEFAULT false,\n      is_bestseller BOOLEAN DEFAULT false,\n      rating NUMERIC(3,2) DEFAULT 0,\n      reviews_count INTEGER DEFAULT 0,\n      units_sold INTEGER DEFAULT 0,\n      revenue_pkr INTEGER DEFAULT 0,\n      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n    );\n    \n    CREATE TABLE IF NOT EXISTS banners (\n      id SERIAL PRIMARY KEY,\n      title VARCHAR(500) NOT NULL,\n      subtitle TEXT,\n      badge_text VARCHAR(100),\n      cta_text VARCHAR(200),\n      cta_link VARCHAR(500),\n      desktop_image_url TEXT,\n      mobile_image_url TEXT,\n      device_target VARCHAR(20) DEFAULT 'both' CHECK (device_target IN ('both', 'desktop', 'mobile')),\n      theme_style VARCHAR(50),\n      overlay_opacity NUMERIC(4,2) DEFAULT 0.35,\n      sort_order INTEGER DEFAULT 0,\n      is_active BOOLEAN DEFAULT true,\n      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n    );\n    \n    CREATE TABLE IF NOT EXISTS coupons (\n      id SERIAL PRIMARY KEY,\n      code VARCHAR(100) UNIQUE NOT NULL,\n      discount_type VARCHAR(20) CHECK (discount_type IN ('percentage', 'fixed')),\n      discount_value NUMERIC(10,2) NOT NULL,\n      min_spend_pkr INTEGER DEFAULT 0,\n      max_discount_pkr INTEGER,\n      usage_limit INTEGER,\n      times_used INTEGER DEFAULT 0,\n      is_active BOOLEAN DEFAULT true,\n      expires_at TIMESTAMP,\n      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n    );\n    \n    CREATE TABLE IF NOT EXISTS orders (\n      id SERIAL PRIMARY KEY,\n      order_number VARCHAR(50) UNIQUE NOT NULL,\n      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,\n      customer_name VARCHAR(255),\n      customer_email VARCHAR(255),\n      customer_phone VARCHAR(50),\n      shipping_address TEXT,\n      shipping_city VARCHAR(100),\n      shipping_postal_code VARCHAR(20),\n      tracking_number VARCHAR(100),\n      subtotal_pkr INTEGER DEFAULT 0,\n      delivery_fee_pkr INTEGER DEFAULT 300,\n      discount_pkr INTEGER DEFAULT 0,\n      total_pkr INTEGER DEFAULT 0,\n      payment_method VARCHAR(50) DEFAULT 'cod',\n      payment_status VARCHAR(50) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'refunded')),\n      order_status VARCHAR(50) DEFAULT 'pending' CHECK (order_status IN ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled')),\n      status_history JSONB DEFAULT '[]',\n      items_json JSONB DEFAULT '[]',\n      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n    );\n    \n    CREATE TABLE IF NOT EXISTS reviews (\n      id SERIAL PRIMARY KEY,\n      product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,\n      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,\n      customer_name VARCHAR(255),\n      customer_city VARCHAR(100),\n      rating INTEGER CHECK (rating >= 1 AND rating <= 5),\n      comment TEXT,\n      verified_buyer BOOLEAN DEFAULT false,\n      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n    );\n    \n    CREATE TABLE IF NOT EXISTS store_settings (\n      id SERIAL PRIMARY KEY,\n      setting_key VARCHAR(255) UNIQUE NOT NULL,\n      setting_value JSONB,\n      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n    );\n    \n    CREATE TABLE IF NOT EXISTS restock_notifications (\n      id SERIAL PRIMARY KEY,\n      product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,\n      customer_email VARCHAR(255),\n      preferred_size VARCHAR(50),\n      preferred_color VARCHAR(100),\n      status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'notified')),\n      notified_at TIMESTAMP,\n      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n    );\n    \n    CREATE TABLE IF NOT EXISTS audit_logs (\n      id SERIAL PRIMARY KEY,\n      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,\n      action VARCHAR(100),\n      details TEXT,\n      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n    );\n    \n    CREATE TABLE IF NOT EXISTS pages (\n      id SERIAL PRIMARY KEY,\n      slug VARCHAR(255) UNIQUE NOT NULL,\n      title VARCHAR(500),\n      content TEXT,\n      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n    );\n    \n    CREATE TABLE IF NOT EXISTS faqs (\n      id SERIAL PRIMARY KEY,\n      question TEXT NOT NULL,\n      answer TEXT NOT NULL,\n      category VARCHAR(100),\n      sort_order INTEGER DEFAULT 0,\n      is_active BOOLEAN DEFAULT true,\n      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n    );\n    \n    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);\n    CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);\n    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_slug);\n    CREATE INDEX IF NOT EXISTS idx_products_subcategory ON products(subcategory_slug);\n    CREATE INDEX IF NOT EXISTS idx_products_slug ON products(slug);\n    CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);\n    CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id);\n    CREATE INDEX IF NOT EXISTS idx_store_settings_key ON store_settings(setting_key);\n    \\\`;
    
    await client.query(sql);\n    console.log('[Database] All tables created successfully');
  } finally {
    client.release();
  }
}

async function seedData() {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT COUNT(*) FROM users WHERE email = $1', ['fonerera@gmail.com']);
    if (parseInt(result.rows[0].count) === 0) {
      console.log('[Database] Seeding default data...');
      
      await client.query(\\\`INSERT INTO users (name, email, phone, city, address, postal_code, role, status, password_hash, total_orders, total_spent_pkr, loyalty_points) VALUES 
        ('Foner Atelier Director', 'fonerera@gmail.com', '+92 300 1234567', 'Lahore', 'Gulberg III Atelier, Lahore', '54000', 'admin', 'active', '$2a$10$samplehash', 12, 495000, 4950),
        ('Sarah Farooq', 'sarah.farooq@example.com', '+92 321 9876543', 'Islamabad', 'F-7/2, Street 14, Islamabad', '44000', 'customer', 'active', NULL, 3, 92500, 925)
        ON CONFLICT (email) DO NOTHING\\\`);

      await client.query(\\\`INSERT INTO categories (id, name, slug, description, image_url, accent_color, product_count, featured, sort_order) VALUES 
        (1, 'Outerwear', 'outerwear', 'Impeccably tailored coats, trench jackets, and structured overcoats crafted from pure cashmere and wool.', '/products/overcoat.jpg', '#631828', 1, true, 1),
        (2, 'Tailoring', 'tailoring', 'Sartorial blazers and precision-cut trousers designed with bespoke silhouettes.', '/products/silk-tailoring.jpg', '#631828', 1, true, 2),
        (3, 'Footwear', 'footwear', 'Handwelted leather loafers and formal dress shoes constructed for endurance.', '/products/loafers.jpg', '#631828', 1, true, 3),
        (4, 'Leather Goods', 'leather-goods', 'Full-grain calfskin weekenders, briefcases, and travel essentials.', '/products/weekender.jpg', '#631828', 1, true, 4),
        (5, 'Knitwear', 'knitwear', 'Superfine merino wool and Mongolian cashmere sweaters.', '/products/overcoat.jpg', '#631828', 0, false, 5)
        ON CONFLICT (slug) DO NOTHING\\\`);
      
      await client.query(\\\`INSERT INTO products (id, title, slug, sku, category_slug, subcategory_slug, price_pkr, compare_at_price_pkr, description, image_url, stock, is_featured, is_new_arrival, is_bestseller, rating, reviews_count, units_sold, revenue_pkr) VALUES 
        (1, 'Double-Breasted Cashmere Overcoat', 'cashmere-overcoat', 'FNR-COT-001', 'outerwear', 'cashmere-overcoats', 38500, 45000, 'Crafted from pure double-faced Mongolian cashmere.', '/products/overcoat.jpg', 23, true, true, true, 4.9, 14, 42, 1617000),
        (2, 'Sartorial Silk Tailored Blazer', 'silk-tailoring', 'FNR-BLZ-002', 'tailoring', 'silk-blazers', 29500, 34000, 'Architectural single-breasted blazer.', '/products/silk-tailoring.jpg', 18, true, true, false, 4.8, 8, 21, 619500),
        (3, 'Handwelted Calfskin Loafers', 'handwelted-loafers', 'FNR-SH-003', 'footwear', 'loafers-slip-ons', 24500, 28000, 'Traditional Goodyear handwelting.', '/products/loafers.jpg', 16, true, false, true, 5.0, 19, 58, 1421000),
        (4, 'Handcrafted Calfskin Weekender', 'calfskin-weekender', 'FNR-BAG-004', 'leather-goods', 'travel-weekenders', 34000, 40000, 'The definitive luxury travel bag.', '/products/weekender.jpg', 14, true, true, true, 4.9, 12, 37, 1258000)
        ON CONFLICT (id) DO NOTHING\\\`);

      await client.query(\\\`INSERT INTO banners (id, title, subtitle, badge_text, cta_text, cta_link, desktop_image_url, mobile_image_url, sort_order, is_active) VALUES 
        (1, 'The Autumn / Winter Atelier', 'Signature double-faced Mongolian cashmere overcoats.', 'New Season', 'Explore Collection →', '/products', '/banners/desktop-banner-1.jpg', '/banners/mobile-banner-1.jpg', 1, true),
        (2, 'Handcrafted in Lahore', 'Every garment is constructed in our Gulberg III atelier.', 'Expert Craft', 'Discover Process →', '/categories', '/banners/desktop-banner-2.jpg', '/banners/mobile-banner-2.jpg', 2, true)
        ON CONFLICT (id) DO NOTHING\\\`);

      const settings = [
        ['store_name', '{\"value\":\"FONER\"}'),
        ['tagline', '{\"value\":\"Tailored outerwear, knitwear, and leather goods.\"}'),
        ['currency', '{\"value\":\"PKR\"}'),
        ['currency_symbol', '{\"value\":\"Rs.\"}'),
        ['delivery_fee_pkr', '{\"value\":300}'),
        ['announcement_bar', '{\"value\":\"Nationwide delivery across Pakistan — Rs. 300 flat shipping rate\"}'),
        ['contact_email', '{\"value\":\"fonerera@gmail.com\"}'),
        ['business_phone', '{\"value\":\"+92 300 1234567\"}'),
        ['business_address', '{\"value\":\"Gulberg III Atelier, Lahore, Pakistan\"}'),
        ['instagram_url', '{\"value\":\"https://instagram.com/foner\"}'),
        ['facebook_url', '{\"value\":\"https://facebook.com/foner\"}'),
        ['footer_copyright_text', '{\"value\":\"© 2026 FONER. All rights reserved.\"}')
      ];
      
      for (const [key, value] of settings) {
        await client.query('INSERT INTO store_settings (setting_key, setting_value) VALUES ($1, $2) ON CONFLICT (setting_key) DO NOTHING', [key, value]);
      }
      
      console.log('[Database] Default data seeded successfully');
    }
  } finally {
    client.release();
  }
}

// Database client helper
async function getDbClient() {
  if (!pool) {
    throw new Error('Database connection not available');
  }
  return await pool.connect();
}

module.exports = { initializeDatabase, getDbClient, pool };
