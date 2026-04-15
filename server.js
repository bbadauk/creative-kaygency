const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');

// ============================================================================
// CONFIGURATION & UTILITIES
// ============================================================================

const PORT = 3000;
const DB_PATH = path.join(__dirname, 'data', 'db.json');
const PUBLIC_PATH = path.join(__dirname, 'public');

// MIME types mapping
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject'
};

// Rate limiting in-memory store
const rateLimitStore = new Map();

// ============================================================================
// DATABASE FUNCTIONS
// ============================================================================

function loadDatabase() {
  try {
    const data = fs.readFileSync(DB_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading database:', error.message);
    return null;
  }
}

function saveDatabase(db) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving database:', error.message);
    return false;
  }
}

// ============================================================================
// SECURITY & AUTHENTICATION
// ============================================================================

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function generateToken(userId, email) {
  const payload = `${userId}:${email}:${Date.now()}`;
  const token = crypto.createHmac('sha256', 'creative-kaygency-secret-key').update(payload).digest('hex');
  return `${Buffer.from(payload).toString('base64')}.${token}`;
}

function verifyToken(token) {
  try {
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;

    const decodedPayload = Buffer.from(payload, 'base64').toString('utf-8');
    const [userId, email] = decodedPayload.split(':');

    const expectedToken = crypto.createHmac('sha256', 'creative-kaygency-secret-key').update(decodedPayload).digest('hex');

    if (signature === expectedToken) {
      return { userId, email };
    }
    return null;
  } catch (error) {
    return null;
  }
}

function getAuthUser(req, db) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7);
  const decoded = verifyToken(token);

  if (!decoded) return null;

  const user = db.users.find(u => u.id === decoded.userId);
  return user || null;
}

// ============================================================================
// RATE LIMITING
// ============================================================================

function checkRateLimit(ip, limit = 100, windowMs = 60000) {
  const now = Date.now();
  if (!rateLimitStore.has(ip)) {
    rateLimitStore.set(ip, { count: 1, resetTime: now + windowMs });
    return true;
  }

  const record = rateLimitStore.get(ip);
  if (now > record.resetTime) {
    rateLimitStore.set(ip, { count: 1, resetTime: now + windowMs });
    return true;
  }

  if (record.count >= limit) {
    return false;
  }

  record.count++;
  return true;
}

// ============================================================================
// RESPONSE HELPERS
// ============================================================================

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

function sendError(res, statusCode, message) {
  sendJSON(res, statusCode, { error: message });
}

function sendFile(res, filePath, statusCode = 200) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      sendError(res, 404, 'File not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(statusCode, {
      'Content-Type': mimeType,
      'Access-Control-Allow-Origin': '*'
    });
    res.end(content);
  });
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

function validatePassword(password) {
  return password && password.length >= 6;
}

// ============================================================================
// API ROUTE HANDLERS
// ============================================================================

// AUTH ROUTES
function handleAuth(req, res, db, parsedUrl, method) {
  const pathname = parsedUrl.pathname;

  if (pathname === '/api/auth/register' && method === 'POST') {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const { name, email, password } = JSON.parse(body);

        if (!name || !email || !password) {
          return sendError(res, 400, 'Missing required fields');
        }

        if (!validateEmail(email)) {
          return sendError(res, 400, 'Invalid email format');
        }

        if (!validatePassword(password)) {
          return sendError(res, 400, 'Password must be at least 6 characters');
        }

        if (db.users.find(u => u.email === email)) {
          return sendError(res, 409, 'Email already registered');
        }

        const userId = `usr_${crypto.randomBytes(6).toString('hex')}`;
        const newUser = {
          id: userId,
          name,
          email,
          passwordHash: hashPassword(password),
          role: 'user',
          credits: 100,
          createdAt: new Date().toISOString(),
          status: 'active',
          referralCode: `${name.split(' ')[0].toUpperCase()}${Date.now().toString().slice(-3)}`,
          referralCount: 0
        };

        db.users.push(newUser);
        saveDatabase(db);

        sendJSON(res, 201, {
          message: 'User registered successfully',
          user: { id: newUser.id, email: newUser.email, name: newUser.name }
        });
      } catch (error) {
        sendError(res, 400, 'Invalid request body');
      }
    });
    return;
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const { email, password } = JSON.parse(body);

        if (!email || !password) {
          return sendError(res, 400, 'Email and password required');
        }

        const user = db.users.find(u => u.email === email);

        if (!user || user.passwordHash !== hashPassword(password)) {
          return sendError(res, 401, 'Invalid credentials');
        }

        const token = generateToken(user.id, user.email);

        sendJSON(res, 200, {
          token,
          user: { id: user.id, email: user.email, name: user.name, role: user.role, credits: user.credits }
        });
      } catch (error) {
        sendError(res, 400, 'Invalid request body');
      }
    });
    return;
  }

  if (pathname === '/api/auth/me' && method === 'GET') {
    const authUser = getAuthUser(req, db);

    if (!authUser) {
      return sendError(res, 401, 'Unauthorized');
    }

    sendJSON(res, 200, {
      user: {
        id: authUser.id,
        name: authUser.name,
        email: authUser.email,
        role: authUser.role,
        credits: authUser.credits,
        referralCode: authUser.referralCode
      }
    });
    return;
  }
}

// USERS ROUTES
function handleUsers(req, res, db, parsedUrl, method) {
  const pathname = parsedUrl.pathname;
  const authUser = getAuthUser(req, db);

  if (pathname === '/api/users' && method === 'GET') {
    if (!authUser || authUser.role !== 'admin') {
      return sendError(res, 403, 'Forbidden');
    }

    const users = db.users.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      credits: u.credits,
      createdAt: u.createdAt
    }));

    sendJSON(res, 200, { users });
    return;
  }

  const userIdMatch = pathname.match(/^\/api\/users\/([a-z0-9_]+)$/);

  if (userIdMatch && method === 'GET') {
    if (!authUser) {
      return sendError(res, 401, 'Unauthorized');
    }

    const userId = userIdMatch[1];
    const user = db.users.find(u => u.id === userId);

    if (!user) {
      return sendError(res, 404, 'User not found');
    }

    if (authUser.id !== userId && authUser.role !== 'admin') {
      return sendError(res, 403, 'Forbidden');
    }

    sendJSON(res, 200, {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        credits: user.credits,
        role: user.role,
        createdAt: user.createdAt
      }
    });
    return;
  }

  if (userIdMatch && method === 'PUT') {
    if (!authUser) {
      return sendError(res, 401, 'Unauthorized');
    }

    const userId = userIdMatch[1];
    if (authUser.id !== userId && authUser.role !== 'admin') {
      return sendError(res, 403, 'Forbidden');
    }

    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const updates = JSON.parse(body);
        const user = db.users.find(u => u.id === userId);

        if (!user) {
          return sendError(res, 404, 'User not found');
        }

        if (updates.name) user.name = updates.name;
        if (updates.credits !== undefined && authUser.role === 'admin') user.credits = updates.credits;

        saveDatabase(db);

        sendJSON(res, 200, {
          message: 'User updated',
          user: { id: user.id, name: user.name, email: user.email, credits: user.credits }
        });
      } catch (error) {
        sendError(res, 400, 'Invalid request body');
      }
    });
    return;
  }

  if (userIdMatch && method === 'DELETE') {
    if (!authUser || authUser.role !== 'admin') {
      return sendError(res, 403, 'Forbidden');
    }

    const userId = userIdMatch[1];
    const userIndex = db.users.findIndex(u => u.id === userId);

    if (userIndex === -1) {
      return sendError(res, 404, 'User not found');
    }

    db.users.splice(userIndex, 1);
    saveDatabase(db);

    sendJSON(res, 200, { message: 'User deleted' });
    return;
  }
}

// CREDITS ROUTES
function handleCredits(req, res, db, parsedUrl, method) {
  const pathname = parsedUrl.pathname;
  const authUser = getAuthUser(req, db);

  if (!authUser) {
    return sendError(res, 401, 'Unauthorized');
  }

  if (pathname === '/api/credits/balance' && method === 'GET') {
    sendJSON(res, 200, {
      userId: authUser.id,
      balance: authUser.credits,
      currency: db.settings.currency
    });
    return;
  }

  if (pathname === '/api/credits/purchase' && method === 'POST') {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const { amount, paymentMethod } = JSON.parse(body);

        if (!amount || amount <= 0) {
          return sendError(res, 400, 'Invalid amount');
        }

        const creditAmount = Math.round(amount * db.settings.creditToGbpRatio);
        const user = db.users.find(u => u.id === authUser.id);

        const balanceBefore = user.credits;
        user.credits += creditAmount;

        const transaction = {
          id: `txn_${crypto.randomBytes(4).toString('hex')}`,
          userId: user.id,
          type: 'purchase',
          amount: creditAmount,
          balanceBefore,
          balanceAfter: user.credits,
          description: `Credit purchase - £${amount} spend`,
          timestamp: new Date().toISOString()
        };

        db.credits.push(transaction);
        saveDatabase(db);

        sendJSON(res, 200, {
          message: 'Credits purchased',
          transaction,
          newBalance: user.credits
        });
      } catch (error) {
        sendError(res, 400, 'Invalid request body');
      }
    });
    return;
  }

  if (pathname === '/api/credits/deduct' && method === 'POST') {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const { amount, description } = JSON.parse(body);

        if (!amount || amount <= 0) {
          return sendError(res, 400, 'Invalid amount');
        }

        const user = db.users.find(u => u.id === authUser.id);

        if (user.credits < amount) {
          return sendError(res, 400, 'Insufficient credits');
        }

        const balanceBefore = user.credits;
        user.credits -= amount;

        const transaction = {
          id: `txn_${crypto.randomBytes(4).toString('hex')}`,
          userId: user.id,
          type: 'deduct',
          amount: -amount,
          balanceBefore,
          balanceAfter: user.credits,
          description: description || 'Credit deduction',
          timestamp: new Date().toISOString()
        };

        db.credits.push(transaction);
        saveDatabase(db);

        sendJSON(res, 200, {
          message: 'Credits deducted',
          transaction,
          newBalance: user.credits
        });
      } catch (error) {
        sendError(res, 400, 'Invalid request body');
      }
    });
    return;
  }

  if (pathname === '/api/credits/daily-login' && method === 'POST') {
    const user = db.users.find(u => u.id === authUser.id);
    const lastLoginDate = user.lastLoginDate ? new Date(user.lastLoginDate).toDateString() : null;
    const today = new Date().toDateString();

    if (lastLoginDate === today) {
      return sendError(res, 400, 'Daily bonus already claimed today');
    }

    const balanceBefore = user.credits;
    user.credits += db.settings.dailyLoginBonus;
    user.lastLoginDate = new Date().toISOString();

    const transaction = {
      id: `txn_${crypto.randomBytes(4).toString('hex')}`,
      userId: user.id,
      type: 'daily-login',
      amount: db.settings.dailyLoginBonus,
      balanceBefore,
      balanceAfter: user.credits,
      description: 'Daily login bonus',
      timestamp: new Date().toISOString()
    };

    db.credits.push(transaction);
    saveDatabase(db);

    sendJSON(res, 200, {
      message: 'Daily bonus claimed',
      bonusAmount: db.settings.dailyLoginBonus,
      newBalance: user.credits
    });
    return;
  }

  if (pathname === '/api/credits/history' && method === 'GET') {
    const query = parsedUrl.query;
    const limit = parseInt(query.limit) || 20;

    const history = db.credits
      .filter(t => t.userId === authUser.id)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);

    sendJSON(res, 200, { transactions: history });
    return;
  }
}

// SERVICES ROUTES
function handleServices(req, res, db, parsedUrl, method) {
  const pathname = parsedUrl.pathname;

  if (pathname === '/api/services' && method === 'GET') {
    sendJSON(res, 200, { services: db.services });
    return;
  }

  const serviceIdMatch = pathname.match(/^\/api\/services\/([a-z0-9_]+)$/);

  if (serviceIdMatch && method === 'GET') {
    const serviceId = serviceIdMatch[1];
    const service = db.services.find(s => s.id === serviceId);

    if (!service) {
      return sendError(res, 404, 'Service not found');
    }

    sendJSON(res, 200, { service });
    return;
  }

  if (serviceIdMatch && method === 'PUT') {
    const authUser = getAuthUser(req, db);

    if (!authUser || authUser.role !== 'admin') {
      return sendError(res, 403, 'Forbidden');
    }

    const serviceId = serviceIdMatch[1];
    const service = db.services.find(s => s.id === serviceId);

    if (!service) {
      return sendError(res, 404, 'Service not found');
    }

    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const updates = JSON.parse(body);

        if (updates.name) service.name = updates.name;
        if (updates.description) service.description = updates.description;
        if (updates.cashPriceMin) service.cashPriceMin = updates.cashPriceMin;
        if (updates.cashPriceMax) service.cashPriceMax = updates.cashPriceMax;
        if (updates.creditPriceMin) service.creditPriceMin = updates.creditPriceMin;
        if (updates.creditPriceMax) service.creditPriceMax = updates.creditPriceMax;

        saveDatabase(db);

        sendJSON(res, 200, { message: 'Service updated', service });
      } catch (error) {
        sendError(res, 400, 'Invalid request body');
      }
    });
    return;
  }
}

// BOOKINGS ROUTES
function handleBookings(req, res, db, parsedUrl, method) {
  const pathname = parsedUrl.pathname;
  const authUser = getAuthUser(req, db);

  if (!authUser) {
    return sendError(res, 401, 'Unauthorized');
  }

  if (pathname === '/api/bookings' && method === 'POST') {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const { serviceId, paymentMethod, customDetails } = JSON.parse(body);

        if (!serviceId || !paymentMethod) {
          return sendError(res, 400, 'Missing required fields');
        }

        const service = db.services.find(s => s.id === serviceId);
        if (!service) {
          return sendError(res, 404, 'Service not found');
        }

        const user = db.users.find(u => u.id === authUser.id);
        const amountCharged = (service.cashPriceMin + service.cashPriceMax) / 2;

        if (paymentMethod === 'credits') {
          const creditsNeeded = (service.creditPriceMin + service.creditPriceMax) / 2;
          if (user.credits < creditsNeeded) {
            return sendError(res, 400, 'Insufficient credits');
          }
          user.credits -= creditsNeeded;
        }

        const booking = {
          id: `bkg_${crypto.randomBytes(4).toString('hex')}`,
          userId: authUser.id,
          serviceId,
          status: 'pending',
          paymentMethod,
          amountCharged: Math.round(amountCharged),
          currency: db.settings.currency,
          customDetails: customDetails || {},
          createdAt: new Date().toISOString(),
          estimatedDelivery: new Date(Date.now() + service.turnaroundDays * 24 * 60 * 60 * 1000).toISOString()
        };

        db.bookings.push(booking);
        saveDatabase(db);

        sendJSON(res, 201, {
          message: 'Booking created',
          booking
        });
      } catch (error) {
        sendError(res, 400, 'Invalid request body');
      }
    });
    return;
  }

  if (pathname === '/api/bookings' && method === 'GET') {
    const userBookings = db.bookings.filter(b => b.userId === authUser.id);
    sendJSON(res, 200, { bookings: userBookings });
    return;
  }

  if (pathname === '/api/bookings/all' && method === 'GET') {
    if (authUser.role !== 'admin') {
      return sendError(res, 403, 'Forbidden');
    }

    sendJSON(res, 200, { bookings: db.bookings });
    return;
  }

  const bookingIdMatch = pathname.match(/^\/api\/bookings\/([a-z0-9_]+)$/);

  if (bookingIdMatch && method === 'PUT') {
    if (authUser.role !== 'admin') {
      return sendError(res, 403, 'Forbidden');
    }

    const bookingId = bookingIdMatch[1];
    const booking = db.bookings.find(b => b.id === bookingId);

    if (!booking) {
      return sendError(res, 404, 'Booking not found');
    }

    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const { status } = JSON.parse(body);

        if (status) {
          booking.status = status;
          if (status === 'completed') {
            booking.completedAt = new Date().toISOString();
          }
        }

        saveDatabase(db);

        sendJSON(res, 200, { message: 'Booking updated', booking });
      } catch (error) {
        sendError(res, 400, 'Invalid request body');
      }
    });
    return;
  }
}

// SUBSCRIPTIONS ROUTES
function handleSubscriptions(req, res, db, parsedUrl, method) {
  const pathname = parsedUrl.pathname;
  const authUser = getAuthUser(req, db);

  if (!authUser) {
    return sendError(res, 401, 'Unauthorized');
  }

  if (pathname === '/api/subscriptions' && method === 'POST') {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const { planName, monthlyPrice, monthlyCredits } = JSON.parse(body);

        if (!planName || !monthlyPrice) {
          return sendError(res, 400, 'Missing required fields');
        }

        const existingSub = db.subscriptions.find(s => s.userId === authUser.id && s.status === 'active');
        if (existingSub) {
          return sendError(res, 400, 'User already has active subscription');
        }

        const subscription = {
          id: `sub_${crypto.randomBytes(4).toString('hex')}`,
          userId: authUser.id,
          planName,
          monthlyCredits: monthlyCredits || 100,
          monthlyPrice,
          billingCycle: 'monthly',
          status: 'active',
          createdAt: new Date().toISOString(),
          renewalDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          autoRenew: true,
          features: [`${monthlyCredits || 100} monthly credits`, 'Email support']
        };

        db.subscriptions.push(subscription);
        saveDatabase(db);

        sendJSON(res, 201, {
          message: 'Subscription created',
          subscription
        });
      } catch (error) {
        sendError(res, 400, 'Invalid request body');
      }
    });
    return;
  }

  if (pathname === '/api/subscriptions/current' && method === 'GET') {
    const subscription = db.subscriptions.find(s => s.userId === authUser.id && s.status === 'active');

    if (!subscription) {
      return sendJSON(res, 200, { subscription: null });
    }

    sendJSON(res, 200, { subscription });
    return;
  }

  const subIdMatch = pathname.match(/^\/api\/subscriptions\/([a-z0-9_]+)\/cancel$/);

  if (subIdMatch && method === 'PUT') {
    const subId = subIdMatch[1];
    const subscription = db.subscriptions.find(s => s.id === subId);

    if (!subscription) {
      return sendError(res, 404, 'Subscription not found');
    }

    if (subscription.userId !== authUser.id && authUser.role !== 'admin') {
      return sendError(res, 403, 'Forbidden');
    }

    subscription.status = 'cancelled';
    subscription.cancelledAt = new Date().toISOString();

    saveDatabase(db);

    sendJSON(res, 200, { message: 'Subscription cancelled', subscription });
    return;
  }
}

// GAMIFICATION ROUTES
function handleGamification(req, res, db, parsedUrl, method) {
  const pathname = parsedUrl.pathname;
  const authUser = getAuthUser(req, db);

  if (!authUser) {
    return sendError(res, 401, 'Unauthorized');
  }

  if (pathname === '/api/gamification/profile' && method === 'GET') {
    const gam = db.gamification.find(g => g.userId === authUser.id);

    if (!gam) {
      return sendJSON(res, 200, {
        profile: {
          userId: authUser.id,
          loginStreak: 0,
          badges: [],
          totalPoints: 0,
          referralCount: 0
        }
      });
    }

    sendJSON(res, 200, { profile: gam });
    return;
  }

  if (pathname === '/api/gamification/checkin' && method === 'POST') {
    let gam = db.gamification.find(g => g.userId === authUser.id);

    if (!gam) {
      gam = {
        id: `gam_${crypto.randomBytes(4).toString('hex')}`,
        userId: authUser.id,
        loginStreak: 1,
        badges: [],
        totalPoints: 10,
        referralCount: 0,
        lastCheckIn: new Date().toISOString()
      };
      db.gamification.push(gam);
    } else {
      const lastCheckIn = new Date(gam.lastCheckIn);
      const now = new Date();
      const daysDiff = Math.floor((now - lastCheckIn) / (1000 * 60 * 60 * 24));

      if (daysDiff === 0) {
        return sendError(res, 400, 'Already checked in today');
      }

      if (daysDiff === 1) {
        gam.loginStreak++;
      } else {
        gam.loginStreak = 1;
      }

      gam.totalPoints += 10;
      gam.lastCheckIn = new Date().toISOString();
    }

    saveDatabase(db);

    sendJSON(res, 200, {
      message: 'Check-in successful',
      profile: gam
    });
    return;
  }

  if (pathname === '/api/gamification/leaderboard' && method === 'GET') {
    const leaderboard = db.gamification
      .sort((a, b) => b.referralCount - a.referralCount)
      .slice(0, 10)
      .map(g => {
        const user = db.users.find(u => u.id === g.userId);
        return {
          userId: g.userId,
          userName: user?.name || 'Unknown',
          referralCount: g.referralCount,
          totalPoints: g.totalPoints
        };
      });

    sendJSON(res, 200, { leaderboard });
    return;
  }
}

// REFERRAL ROUTES
function handleReferral(req, res, db, parsedUrl, method) {
  const pathname = parsedUrl.pathname;
  const authUser = getAuthUser(req, db);

  if (!authUser) {
    return sendError(res, 401, 'Unauthorized');
  }

  if (pathname === '/api/referral/generate' && method === 'POST') {
    const user = db.users.find(u => u.id === authUser.id);

    sendJSON(res, 200, {
      referralCode: user.referralCode,
      referralLink: `https://creative-kaygency.com?ref=${user.referralCode}`,
      referralCount: user.referralCount
    });
    return;
  }

  if (pathname === '/api/referral/redeem' && method === 'POST') {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const { referralCode } = JSON.parse(body);

        if (!referralCode) {
          return sendError(res, 400, 'Referral code required');
        }

        const referrer = db.users.find(u => u.referralCode === referralCode);

        if (!referrer) {
          return sendError(res, 400, 'Invalid referral code');
        }

        const existingRef = db.referrals.find(r => r.referredUserId === authUser.id);
        if (existingRef) {
          return sendError(res, 400, 'Already redeemed a referral');
        }

        const referral = {
          id: `ref_${crypto.randomBytes(4).toString('hex')}`,
          referrerUserId: referrer.id,
          referrerCode: referralCode,
          referredUserId: authUser.id,
          status: 'converted',
          creditsAwarded: db.settings.referralBonus,
          createdAt: new Date().toISOString(),
          convertedAt: new Date().toISOString()
        };

        referrer.credits += db.settings.referralBonus;
        referrer.referralCount++;

        db.referrals.push(referral);
        saveDatabase(db);

        sendJSON(res, 200, {
          message: 'Referral redeemed',
          creditsAwarded: db.settings.referralBonus
        });
      } catch (error) {
        sendError(res, 400, 'Invalid request body');
      }
    });
    return;
  }
}

// BLOG ROUTES
function handleBlog(req, res, db, parsedUrl, method) {
  const pathname = parsedUrl.pathname;
  const authUser = getAuthUser(req, db);

  if (pathname === '/api/blog' && method === 'GET') {
    const query = parsedUrl.query;
    const category = query.category;

    let posts = db.blogPosts.filter(p => p.published);

    if (category) {
      posts = posts.filter(p => p.category === category);
    }

    posts = posts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    sendJSON(res, 200, { posts });
    return;
  }

  if (pathname === '/api/blog' && method === 'POST') {
    if (!authUser || authUser.role !== 'admin') {
      return sendError(res, 403, 'Forbidden');
    }

    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const { title, content, excerpt, category } = JSON.parse(body);

        if (!title || !content || !category) {
          return sendError(res, 400, 'Missing required fields');
        }

        const slug = title.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');

        const post = {
          id: `blog_${crypto.randomBytes(4).toString('hex')}`,
          slug,
          title,
          author: authUser.name,
          content,
          excerpt: excerpt || content.substring(0, 100),
          category,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          published: true,
          views: 0
        };

        db.blogPosts.push(post);
        saveDatabase(db);

        sendJSON(res, 201, { message: 'Post created', post });
      } catch (error) {
        sendError(res, 400, 'Invalid request body');
      }
    });
    return;
  }

  const slugMatch = pathname.match(/^\/api\/blog\/([a-z0-9-]+)$/);

  if (slugMatch && method === 'GET') {
    const slug = slugMatch[1];
    const post = db.blogPosts.find(p => p.slug === slug);

    if (!post) {
      return sendError(res, 404, 'Post not found');
    }

    post.views++;
    saveDatabase(db);

    sendJSON(res, 200, { post });
    return;
  }
}

// ADMIN ROUTES
function handleAdmin(req, res, db, parsedUrl, method) {
  const pathname = parsedUrl.pathname;
  const authUser = getAuthUser(req, db);

  if (!authUser || authUser.role !== 'admin') {
    return sendError(res, 403, 'Forbidden');
  }

  if (pathname === '/api/admin/stats' && method === 'GET') {
    const totalRevenue = db.bookings.reduce((sum, b) => sum + b.amountCharged, 0);
    const totalUsers = db.users.length;
    const totalBookings = db.bookings.length;
    const totalCreditsIssued = db.credits.reduce((sum, c) => sum + Math.abs(c.amount), 0);

    sendJSON(res, 200, {
      stats: {
        totalRevenue,
        totalUsers,
        totalBookings,
        totalCreditsIssued,
        completedBookings: db.bookings.filter(b => b.status === 'completed').length,
        activeSubscriptions: db.subscriptions.filter(s => s.status === 'active').length
      }
    });
    return;
  }

  if (pathname === '/api/admin/settings' && method === 'GET') {
    sendJSON(res, 200, { settings: db.settings });
    return;
  }

  if (pathname === '/api/admin/settings' && method === 'PUT') {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const updates = JSON.parse(body);

        Object.assign(db.settings, updates);
        saveDatabase(db);

        sendJSON(res, 200, { message: 'Settings updated', settings: db.settings });
      } catch (error) {
        sendError(res, 400, 'Invalid request body');
      }
    });
    return;
  }
}

// CURRENCY ROUTES
function handleCurrency(req, res, db, parsedUrl, method) {
  const pathname = parsedUrl.pathname;

  if (pathname === '/api/currency/rates' && method === 'GET') {
    sendJSON(res, 200, {
      baseCurrency: 'GBP',
      rates: {
        GBP: 1.0,
        USD: 1.27,
        EUR: 1.17
      }
    });
    return;
  }
}

// ============================================================================
// REQUEST ROUTER
// ============================================================================

function handleRequest(req, res) {
  const ip = req.socket.remoteAddress || '127.0.0.1';

  // Rate limiting
  if (!checkRateLimit(ip)) {
    return sendError(res, 429, 'Too many requests');
  }

  const parsedUrl = url.parse(req.url, true);
  const method = req.method.toUpperCase();
  const pathname = parsedUrl.pathname;

  // Load database
  const db = loadDatabase();
  if (!db) {
    return sendError(res, 500, 'Database error');
  }

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end();
    return;
  }

  // Route API requests
  if (pathname.startsWith('/api/auth/')) {
    return handleAuth(req, res, db, parsedUrl, method);
  }

  if (pathname.startsWith('/api/users')) {
    return handleUsers(req, res, db, parsedUrl, method);
  }

  if (pathname.startsWith('/api/credits')) {
    return handleCredits(req, res, db, parsedUrl, method);
  }

  if (pathname.startsWith('/api/services')) {
    return handleServices(req, res, db, parsedUrl, method);
  }

  if (pathname.startsWith('/api/bookings')) {
    return handleBookings(req, res, db, parsedUrl, method);
  }

  if (pathname.startsWith('/api/subscriptions')) {
    return handleSubscriptions(req, res, db, parsedUrl, method);
  }

  if (pathname.startsWith('/api/gamification')) {
    return handleGamification(req, res, db, parsedUrl, method);
  }

  if (pathname.startsWith('/api/referral')) {
    return handleReferral(req, res, db, parsedUrl, method);
  }

  if (pathname.startsWith('/api/blog')) {
    return handleBlog(req, res, db, parsedUrl, method);
  }

  if (pathname.startsWith('/api/admin')) {
    return handleAdmin(req, res, db, parsedUrl, method);
  }

  if (pathname.startsWith('/api/currency')) {
    return handleCurrency(req, res, db, parsedUrl, method);
  }

  // Serve static files
  if (pathname === '/') {
    return sendFile(res, path.join(PUBLIC_PATH, 'index.html'));
  }

  const filePath = path.join(PUBLIC_PATH, pathname);

  // Security: prevent directory traversal
  if (!filePath.startsWith(PUBLIC_PATH)) {
    return sendError(res, 403, 'Forbidden');
  }

  // Check if file exists
  fs.stat(filePath, (err, stats) => {
    if (err) {
      return sendError(res, 404, 'Not found');
    }

    if (stats.isDirectory()) {
      return sendFile(res, path.join(filePath, 'index.html'));
    }

    sendFile(res, filePath);
  });
}

// ============================================================================
// SERVER STARTUP
// ============================================================================

const server = http.createServer(handleRequest);

const banner = `
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║         Creative Kaygency Backend Server v1.0.0           ║
║                                                            ║
║              Built with Node.js Core Modules              ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`;

server.listen(PORT, '0.0.0.0', () => {
  console.log(banner);
  console.log(`✓ Server running on http://localhost:${PORT}`);
  console.log(`✓ Database: ${DB_PATH}`);
  console.log(`✓ Public files: ${PUBLIC_PATH}`);
  console.log(`✓ Features: Auth, Users, Credits, Services, Bookings, Subscriptions, Gamification, Blog, Admin`);
  console.log(`✓ Rate limiting: 100 requests per minute`);
  console.log('\n');
});

server.on('error', (err) => {
  console.error('Server error:', err.message);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err.message);
  process.exit(1);
});
