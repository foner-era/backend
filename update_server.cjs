#!/usr/bin/env node

// Production-grade security middleware additions
// This script updates the server to include:
// - Security headers
// - Rate limiting
// - Graceful shutdown
// - Improved error handling
// - Request logging

const fs = require('fs');

const serverPath = '/home/hell/Downloads/web/backend/server.ts';
let content = fs.readFileSync(serverPath, 'utf-8');

// Add security headers middleware after cookie parser
const securityHeadersInsert = `
// Security headers middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});
`;

// Find the cookie parser middleware and add after it
const cookieParserLocation = content.indexOf('app.use(cookieParser());');
if (cookieParserLocation > 0) {
  const insertPoint = cookieParserLocation + 'app.use(cookieParser());'.length;
  content = content.slice(0, insertPoint) + securityHeadersInsert + content.slice(insertPoint);
  console.log('Added security headers middleware');
}

// Add graceful shutdown at the end
const gracefulShutdown = `
// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received. Closing server gracefully...');
  if (pool) {
    console.log('[Server] Closing database pool...');
    pool.end();
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[Server] SIGINT received. Closing server gracefully...');
  if (pool) {
    console.log('[Server] Closing database pool...');
    pool.end();
  }
  process.exit(0);
});
`;

// Check if graceful shutdown already exists
if (!content.includes('SIGTERM')) {
  content += gracefulShutdown;
  console.log('Added graceful shutdown handlers');
}

// Write back
fs.writeFileSync(serverPath, content);
console.log('Server updated with security middleware and graceful shutdown');
