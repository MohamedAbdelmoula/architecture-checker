// Configuration de sécurité complète
// À adapter selon votre framework (Express, Fastify, etc.)

import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import slowDown from 'express-slow-down';

// Configuration CSP (Content Security Policy)
const cspConfig = {
  directives: {
    defaultSrc: ["'self'"],
    styleSrc: [
      "'self'", 
      "'unsafe-inline'", // À éviter en production, utiliser nonces
      "https://fonts.googleapis.com"
    ],
    scriptSrc: [
      "'self'",
      // "'nonce-{{nonce}}'", // Utiliser des nonces en production
      "https://cdn.jsdelivr.net"
    ],
    imgSrc: [
      "'self'", 
      "data:", 
      "https:"
    ],
    connectSrc: [
      "'self'",
      "https://api.your-domain.com"
    ],
    fontSrc: [
      "'self'",
      "https://fonts.gstatic.com"
    ],
    objectSrc: ["'none'"],
    mediaSrc: ["'self'"],
    frameSrc: ["'none'"],
    upgradeInsecureRequests: []
  },
  reportUri: '/csp-violation-report'
};

// Configuration rate limiting
const rateLimitConfig = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limite par IP
  message: {
    error: "Trop de requêtes, réessayez plus tard"
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Skip successful requests (2xx and 3xx)
  skipSuccessfulRequests: false,
  // Skip failed requests (4xx and 5xx)
  skipFailedRequests: false
});

// Configuration slow down
const slowDownConfig = slowDown({
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: 50, // Délai après 50 requêtes
  delayMs: 500 // Augmente de 500ms par requête
});

// Configuration Helmet avec headers de sécurité
const helmetConfig = helmet({
  contentSecurityPolicy: cspConfig,
  
  // HSTS - Force HTTPS
  hsts: {
    maxAge: 31536000, // 1 an
    includeSubDomains: true,
    preload: true
  },
  
  // Prevent clickjacking
  frameguard: {
    action: 'deny'
  },
  
  // Prevent MIME type sniffing
  noSniff: true,
  
  // Disable X-Powered-By header
  hidePoweredBy: true,
  
  // XSS Protection
  xssFilter: true,
  
  // Referrer Policy
  referrerPolicy: {
    policy: ["same-origin"]
  },
  
  // Permissions Policy
  permissionsPolicy: {
    features: {
      geolocation: ["'self'"],
      camera: ["'none'"],
      microphone: ["'none'"],
      usb: ["'none'"],
      payment: ["'self'"]
    }
  }
});

// Middleware de validation JWT
const jwtValidation = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Token manquant' });
  }
  
  try {
    // Valider le JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token invalide' });
  }
};

// Middleware de logging sécurisé
const securityLogger = (req, res, next) => {
  const logData = {
    timestamp: new Date().toISOString(),
    ip: req.ip,
    method: req.method,
    url: req.url,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id || 'anonymous'
  };
  
  // Log des tentatives d'accès suspectes
  if (req.url.includes('../') || req.url.includes('..\\')) {
    console.warn('Tentative de path traversal:', logData);
  }
  
  next();
};

// Middleware de sanitisation des entrées
const inputSanitization = (req, res, next) => {
  // Fonction utilitaire pour nettoyer les chaînes
  const sanitizeString = (str) => {
    if (typeof str !== 'string') return str;
    
    return str
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove scripts
      .replace(/javascript:/gi, '') // Remove javascript: URLs
      .replace(/on\w+="[^"]*"/gi, '') // Remove event handlers
      .trim();
  };
  
  // Sanitiser récursivement les objets
  const sanitizeObject = (obj) => {
    if (typeof obj !== 'object' || obj === null) {
      return typeof obj === 'string' ? sanitizeString(obj) : obj;
    }
    
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      if (Array.isArray(value)) {
        sanitized[key] = value.map(sanitizeObject);
      } else if (typeof value === 'object') {
        sanitized[key] = sanitizeObject(value);
      } else {
        sanitized[key] = sanitizeString(value);
      }
    }
    return sanitized;
  };
  
  // Appliquer la sanitisation
  if (req.body) req.body = sanitizeObject(req.body);
  if (req.query) req.query = sanitizeObject(req.query);
  if (req.params) req.params = sanitizeObject(req.params);
  
  next();
};

// Configuration secrets et variables d'environnement
const validateEnvironment = () => {
  const requiredEnvVars = [
    'JWT_SECRET',
    'DATABASE_URL',
    'REDIS_URL',
    'ENCRYPTION_KEY'
  ];
  
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    throw new Error(`Variables d'environnement manquantes: ${missingVars.join(', ')}`);
  }
  
  // Vérifier la force du secret JWT
  if (process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET doit faire au moins 32 caractères');
  }
};

// Middleware de gestion des erreurs sécurisé
const secureErrorHandler = (err, req, res, next) => {
  // Logger l'erreur complète côté serveur
  console.error('Erreur:', {
    error: err.message,
    stack: err.stack,
    timestamp: new Date().toISOString(),
    url: req.url,
    method: req.method,
    ip: req.ip
  });
  
  // Réponse sécurisée côté client (pas d'exposition de détails)
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  res.status(err.status || 500).json({
    error: 'Erreur interne du serveur',
    message: isDevelopment ? err.message : 'Une erreur est survenue',
    timestamp: new Date().toISOString(),
    ...(isDevelopment && { stack: err.stack })
  });
};

// Export de la configuration
export {
  helmetConfig,
  rateLimitConfig,
  slowDownConfig,
  jwtValidation,
  securityLogger,
  inputSanitization,
  validateEnvironment,
  secureErrorHandler
};

// Exemple d'utilisation avec Express
/*
import express from 'express';
import {
  helmetConfig,
  rateLimitConfig,
  securityLogger,
  inputSanitization,
  secureErrorHandler
} from './security-config.js';

const app = express();

// Valider l'environnement au démarrage
validateEnvironment();

// Appliquer les middlewares de sécurité
app.use(helmetConfig);
app.use(rateLimitConfig);
app.use(securityLogger);
app.use(express.json({ limit: '10mb' }));
app.use(inputSanitization);

// Routes protégées
app.use('/api/protected', jwtValidation);

// Gestionnaire d'erreurs sécurisé (doit être en dernier)
app.use(secureErrorHandler);
*/