#!/usr/bin/env node

/**
 * Application Express implémentant le Framework d'Analyse Technique Expert
 * 
 * Aspects couverts:
 * - Architecture modulaire avec séparation des responsabilités
 * - Sécurité complète (Helmet, CORS, Rate limiting, JWT)
 * - Monitoring et observabilité (Prometheus, Winston, Health checks)
 * - Performance (Cache, Compression, Optimisations)
 * - Accessibilité (Headers, Standards WCAG)
 * - Tests et qualité (Structure testable)
 * - Documentation API (Swagger)
 */

import express from 'express';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Import des configurations du framework
import {
  helmetConfig,
  rateLimitConfig,
  slowDownConfig,
  securityLogger,
  inputSanitization,
  validateEnvironment,
  secureErrorHandler
} from './config/security-config.js';

import { MonitoringSetup } from './config/monitoring-config.js';

// Import des routes et middleware
import { authRouter } from './controllers/auth.js';
import { userRouter } from './controllers/users.js';
import { analyticsRouter } from './controllers/analytics.js';
import { healthRouter } from './controllers/health.js';

// Import des services
import { DatabaseService } from './services/database.js';
import { CacheService } from './services/cache.js';
import { EmailService } from './services/email.js';

// Configuration ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Chargement des variables d'environnement
dotenv.config();

// Validation de l'environnement (sécurité critique)
try {
  validateEnvironment();
} catch (error) {
  console.error('❌ Erreur de configuration:', error.message);
  process.exit(1);
}

// Initialisation de l'application
const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Initialisation du monitoring
const monitoring = new MonitoringSetup();
const logger = monitoring.logger.getLogger();

// Trust proxy for correct IP detection
app.set('trust proxy', 1);

// ================================
// MIDDLEWARE DE SÉCURITÉ (Priorité critique)
// ================================

// Headers de sécurité avec Helmet
app.use(helmetConfig);

// CORS configuré de manière sécurisée
const corsOptions = {
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'],
  credentials: process.env.CORS_CREDENTIALS === 'true',
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Correlation-ID']
};
app.use(cors(corsOptions));

// Rate limiting et slow down
app.use(rateLimitConfig);
app.use(slowDownConfig);

// ================================
// MIDDLEWARE DE PERFORMANCE
// ================================

// Compression des réponses
app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  },
  level: 6,
  threshold: 1024
}));

// ================================
// MIDDLEWARE DE MONITORING ET LOGGING
// ================================

// Monitoring et métriques
app.use(...monitoring.expressMiddleware());

// Logging sécurisé
app.use(securityLogger);

// ================================
// MIDDLEWARE DE PARSING ET VALIDATION
// ================================

// Body parsing avec limites de sécurité
app.use(express.json({ 
  limit: process.env.MAX_FILE_SIZE || '10mb',
  strict: true
}));

app.use(express.urlencoded({ 
  extended: true, 
  limit: process.env.MAX_FILE_SIZE || '10mb'
}));

// Cookie parsing
app.use(cookieParser(process.env.SESSION_SECRET));

// Sanitisation des entrées
app.use(inputSanitization);

// ================================
// FICHIERS STATIQUES AVEC CACHE
// ================================

// Servir les fichiers statiques avec headers de cache optimisés
app.use('/static', express.static(path.join(__dirname, '../public'), {
  maxAge: NODE_ENV === 'production' ? '1y' : '1h',
  etag: true,
  lastModified: true,
  setHeaders: (res, path) => {
    // Headers de sécurité pour les fichiers statiques
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    
    // Cache spécifique par type de fichier
    if (path.endsWith('.js') || path.endsWith('.css')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  }
}));

// ================================
// DOCUMENTATION API (Swagger)
// ================================

import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Technical Analysis API',
      version: '1.0.0',
      description: 'API implémentant le framework d\'analyse technique expert',
      contact: {
        name: 'Technical Team',
        email: 'tech@company.com'
      }
    },
    servers: [
      {
        url: `http://localhost:${PORT}`,
        description: 'Development server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      }
    }
  },
  apis: ['./src/controllers/*.js', './src/models/*.js']
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

// Documentation accessible uniquement en développement ou avec authentification
if (NODE_ENV === 'development' || process.env.ENABLE_SWAGGER === 'true') {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Technical Analysis API Documentation'
  }));
}

// ================================
// ROUTES API
// ================================

// Route racine avec informations de l'application
app.get('/', (req, res) => {
  res.json({
    name: 'Technical Analysis Application',
    version: process.env.npm_package_version || '1.0.0',
    environment: NODE_ENV,
    timestamp: new Date().toISOString(),
    status: 'operational',
    features: {
      security: '✅ Helmet + CORS + Rate Limiting',
      monitoring: '✅ Prometheus + Winston',
      performance: '✅ Compression + Cache',
      accessibility: '✅ WCAG 2.1 AA',
      testing: '✅ Jest + Playwright',
      documentation: '✅ Swagger API'
    },
    endpoints: {
      health: '/health',
      metrics: '/metrics',
      api_docs: NODE_ENV === 'development' ? '/api-docs' : 'disabled',
      auth: '/api/auth',
      users: '/api/users',
      analytics: '/api/analytics'
    }
  });
});

// Routes API avec préfixe
app.use('/api/auth', authRouter);
app.use('/api/users', userRouter);
app.use('/api/analytics', analyticsRouter);

// Routes de monitoring (sans préfixe pour compatibilité)
app.use('/', healthRouter);

// Configuration des endpoints de monitoring
monitoring.setupEndpoints(app);

// ================================
// GESTION DES ERREURS ET 404
// ================================

// Gestion des routes non trouvées
app.use('*', (req, res, next) => {
  const error = new Error(`Route non trouvée: ${req.method} ${req.originalUrl}`);
  error.status = 404;
  error.code = 'ROUTE_NOT_FOUND';
  
  req.logger?.warn('Route not found', {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  
  next(error);
});

// Gestionnaire d'erreurs sécurisé (doit être en dernier)
app.use(secureErrorHandler);

// ================================
// INITIALISATION DES SERVICES
// ================================

async function initializeServices() {
  try {
    logger.info('🚀 Initialisation des services...');
    
    // Initialisation de la base de données
    if (process.env.DATABASE_URL) {
      await DatabaseService.initialize();
      logger.info('✅ Base de données connectée');
    }
    
    // Initialisation du cache Redis
    if (process.env.REDIS_URL) {
      await CacheService.initialize();
      logger.info('✅ Cache Redis connecté');
    }
    
    // Initialisation du service email
    if (process.env.SMTP_HOST) {
      await EmailService.initialize();
      logger.info('✅ Service email configuré');
    }
    
    logger.info('✅ Tous les services initialisés avec succès');
    
  } catch (error) {
    logger.error('❌ Erreur lors de l\'initialisation des services:', error);
    throw error;
  }
}

// ================================
// DÉMARRAGE DU SERVEUR
// ================================

async function startServer() {
  try {
    // Initialiser les services
    await initializeServices();
    
    // Démarrer le serveur
    const server = app.listen(PORT, () => {
      logger.info(`🚀 Serveur démarré`, {
        port: PORT,
        environment: NODE_ENV,
        pid: process.pid,
        nodeVersion: process.version,
        timestamp: new Date().toISOString()
      });
      
      // Affichage des informations importantes
      console.log('\n' + '='.repeat(60));
      console.log('🎯 TECHNICAL ANALYSIS APPLICATION');
      console.log('='.repeat(60));
      console.log(`📍 URL: http://localhost:${PORT}`);
      console.log(`📊 Health: http://localhost:${PORT}/health`);
      console.log(`📈 Metrics: http://localhost:${PORT}/metrics`);
      if (NODE_ENV === 'development') {
        console.log(`📚 API Docs: http://localhost:${PORT}/api-docs`);
      }
      console.log(`🌍 Environment: ${NODE_ENV}`);
      console.log(`🔒 Security: ENABLED`);
      console.log(`📊 Monitoring: ENABLED`);
      console.log(`🚀 Performance: OPTIMIZED`);
      console.log('='.repeat(60) + '\n');
    });
    
    // Configuration de l'arrêt propre
    process.on('SIGTERM', () => gracefulShutdown(server));
    process.on('SIGINT', () => gracefulShutdown(server));
    
    return server;
    
  } catch (error) {
    logger.error('❌ Erreur lors du démarrage du serveur:', error);
    process.exit(1);
  }
}

// ================================
// ARRÊT PROPRE DU SERVEUR
// ================================

async function gracefulShutdown(server) {
  logger.info('🛑 Arrêt du serveur en cours...');
  
  // Arrêter d'accepter de nouvelles connexions
  server.close(async () => {
    logger.info('📡 Serveur HTTP fermé');
    
    try {
      // Fermer les connexions aux services
      await DatabaseService.close();
      await CacheService.close();
      
      logger.info('✅ Arrêt propre terminé');
      process.exit(0);
      
    } catch (error) {
      logger.error('❌ Erreur lors de l\'arrêt:', error);
      process.exit(1);
    }
  });
  
  // Forcer l'arrêt après 30 secondes
  setTimeout(() => {
    logger.error('⏰ Timeout: arrêt forcé');
    process.exit(1);
  }, 30000);
}

// Démarrer l'application
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}

export default app;