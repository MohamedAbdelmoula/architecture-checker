/**
 * Contrôleur Health Check - Framework d'Analyse Technique
 * 
 * Implémente les vérifications de santé selon les bonnes pratiques:
 * - Status général de l'application
 * - Connectivité base de données
 * - Connectivité cache (Redis)
 * - Services externes
 * - Métriques système
 * - Informations de version et uptime
 */

import express from 'express';
import { DatabaseService } from '../services/database.js';
import { CacheService } from '../services/cache.js';

const router = express.Router();

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Vérification de santé de l'application
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Application en bonne santé
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: healthy
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 checks:
 *                   type: object
 *                 uptime:
 *                   type: number
 *                 version:
 *                   type: string
 *       503:
 *         description: Application en mauvaise santé
 */
router.get('/health', async (req, res) => {
  const startTime = Date.now();
  const checks = {};
  let overallStatus = 'healthy';
  
  try {
    // Check 1: Base de données
    try {
      if (process.env.DATABASE_URL) {
        const dbStart = Date.now();
        const isDbHealthy = await DatabaseService.healthCheck();
        checks.database = {
          status: isDbHealthy ? 'healthy' : 'unhealthy',
          responseTime: Date.now() - dbStart,
          details: isDbHealthy ? 'Connection successful' : 'Connection failed'
        };
        if (!isDbHealthy) overallStatus = 'unhealthy';
      } else {
        checks.database = {
          status: 'skipped',
          details: 'Database not configured'
        };
      }
    } catch (error) {
      checks.database = {
        status: 'unhealthy',
        error: error.message,
        details: 'Database connection error'
      };
      overallStatus = 'unhealthy';
    }
    
    // Check 2: Cache Redis
    try {
      if (process.env.REDIS_URL) {
        const cacheStart = Date.now();
        const isCacheHealthy = await CacheService.healthCheck();
        checks.cache = {
          status: isCacheHealthy ? 'healthy' : 'unhealthy',
          responseTime: Date.now() - cacheStart,
          details: isCacheHealthy ? 'Cache responsive' : 'Cache unreachable'
        };
        if (!isCacheHealthy) overallStatus = 'degraded';
      } else {
        checks.cache = {
          status: 'skipped',
          details: 'Cache not configured'
        };
      }
    } catch (error) {
      checks.cache = {
        status: 'unhealthy',
        error: error.message,
        details: 'Cache connection error'
      };
      overallStatus = 'degraded';
    }
    
    // Check 3: Mémoire système
    const memoryUsage = process.memoryUsage();
    const memoryUsagePercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
    checks.memory = {
      status: memoryUsagePercent < 90 ? 'healthy' : 'warning',
      usage: {
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        external: Math.round(memoryUsage.external / 1024 / 1024),
        rss: Math.round(memoryUsage.rss / 1024 / 1024)
      },
      percentage: Math.round(memoryUsagePercent),
      unit: 'MB'
    };
    
    if (memoryUsagePercent > 95) {
      overallStatus = 'unhealthy';
    }
    
    // Check 4: Temps de réponse global
    const responseTime = Date.now() - startTime;
    checks.responseTime = {
      status: responseTime < 1000 ? 'healthy' : 'warning',
      duration: responseTime,
      unit: 'ms'
    };
    
    // Check 5: Uptime et charge
    const uptime = process.uptime();
    checks.uptime = {
      status: 'healthy',
      seconds: Math.round(uptime),
      human: formatUptime(uptime)
    };
    
    // Check 6: Version et environnement
    checks.version = {
      status: 'healthy',
      app: process.env.npm_package_version || '1.0.0',
      node: process.version,
      environment: process.env.NODE_ENV || 'development'
    };
    
    // Déterminer le code de statut HTTP
    const statusCode = overallStatus === 'healthy' ? 200 : 
                      overallStatus === 'degraded' ? 200 : 503;
    
    // Réponse de santé
    const healthResponse = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: Math.round(uptime),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      checks,
      responseTime: Date.now() - startTime
    };
    
    // Headers pour désactiver le cache
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    res.status(statusCode).json(healthResponse);
    
    // Log du check de santé
    req.logger?.info('Health check completed', {
      status: overallStatus,
      responseTime: Date.now() - startTime,
      checks: Object.keys(checks).reduce((acc, key) => {
        acc[key] = checks[key].status;
        return acc;
      }, {})
    });
    
  } catch (error) {
    req.logger?.error('Health check failed', { error: error.message });
    
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal error',
      checks
    });
  }
});

/**
 * @swagger
 * /health/ready:
 *   get:
 *     summary: Vérification de disponibilité (readiness probe)
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Application prête
 *       503:
 *         description: Application non prête
 */
router.get('/health/ready', async (req, res) => {
  try {
    // Vérifications critiques uniquement
    const criticalChecks = [];
    
    // Base de données obligatoire
    if (process.env.DATABASE_URL) {
      const isDbReady = await DatabaseService.healthCheck();
      if (!isDbReady) {
        criticalChecks.push('database');
      }
    }
    
    if (criticalChecks.length > 0) {
      return res.status(503).json({
        ready: false,
        timestamp: new Date().toISOString(),
        failedChecks: criticalChecks
      });
    }
    
    res.json({
      ready: true,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    res.status(503).json({
      ready: false,
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

/**
 * @swagger
 * /health/live:
 *   get:
 *     summary: Vérification de vie (liveness probe)
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Application vivante
 */
router.get('/health/live', (req, res) => {
  // Check basique pour vérifier que l'application répond
  res.json({
    alive: true,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    pid: process.pid
  });
});

// Fonction utilitaire pour formater l'uptime
function formatUptime(uptime) {
  const days = Math.floor(uptime / 86400);
  const hours = Math.floor((uptime % 86400) / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = Math.floor(uptime % 60);
  
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0) parts.push(`${seconds}s`);
  
  return parts.join(' ') || '0s';
}

export { router as healthRouter };