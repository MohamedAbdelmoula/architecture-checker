/**
 * Contrôleur Analytics - Framework d'Analyse Technique
 * 
 * Fonctionnalités:
 * - Métriques business et techniques
 * - Tableaux de bord en temps réel
 * - Rapports d'utilisation et performance
 * - Analyse des tendances
 * - Export de données
 * - Cache intelligent pour optimiser les performances
 */

import express from 'express';
import Joi from 'joi';
import { DatabaseService } from '../services/database.js';
import { CacheService } from '../services/cache.js';
import { jwtValidation } from '../config/security-config.js';

const router = express.Router();

// Middleware d'authentification pour toutes les routes
router.use(jwtValidation);

// Schémas de validation
const analyticsQuerySchema = Joi.object({
  startDate: Joi.date().iso().optional(),
  endDate: Joi.date().iso().optional(),
  granularity: Joi.string().valid('hour', 'day', 'week', 'month').default('day'),
  metrics: Joi.array().items(
    Joi.string().valid('users', 'sessions', 'requests', 'errors', 'performance')
  ).default(['users', 'sessions']),
  groupBy: Joi.string().valid('date', 'user_type', 'source').optional()
});

/**
 * @swagger
 * /api/analytics/dashboard:
 *   get:
 *     summary: Tableau de bord principal
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Données du tableau de bord
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 dashboard:
 *                   type: object
 */
router.get('/dashboard', async (req, res) => {
  try {
    // Tentative de récupération depuis le cache
    const cacheKey = 'analytics_dashboard';
    let dashboard = await CacheService.get(cacheKey);
    
    if (!dashboard) {
      // Collecte des métriques en parallèle
      const [
        userMetrics,
        sessionMetrics,
        performanceMetrics,
        errorMetrics,
        systemMetrics
      ] = await Promise.all([
        getUserMetrics(),
        getSessionMetrics(),
        getPerformanceMetrics(),
        getErrorMetrics(),
        getSystemMetrics()
      ]);
      
      dashboard = {
        users: userMetrics,
        sessions: sessionMetrics,
        performance: performanceMetrics,
        errors: errorMetrics,
        system: systemMetrics,
        lastUpdated: new Date().toISOString()
      };
      
      // Cache pour 5 minutes
      await CacheService.set(cacheKey, dashboard, 300);
    }
    
    req.logger?.info('Analytics dashboard retrieved', { 
      userId: req.user.userId 
    });
    
    res.json({
      success: true,
      dashboard
    });

  } catch (error) {
    req.logger?.error('Error retrieving analytics dashboard', {
      error: error.message,
      userId: req.user.userId
    });
    
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération du tableau de bord'
    });
  }
});

/**
 * @swagger
 * /api/analytics/metrics:
 *   get:
 *     summary: Métriques détaillées avec filtres
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: granularity
 *         schema:
 *           type: string
 *           enum: [hour, day, week, month]
 *     responses:
 *       200:
 *         description: Métriques détaillées
 */
router.get('/metrics', async (req, res) => {
  try {
    // Validation des paramètres
    const { error, value } = analyticsQuerySchema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Paramètres invalides',
        errors: error.details.map(d => d.message)
      });
    }
    
    const { startDate, endDate, granularity, metrics, groupBy } = value;
    
    // Définir les dates par défaut (7 derniers jours)
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    // Construction de la clé de cache
    const cacheKey = `analytics_metrics:${start.toISOString()}:${end.toISOString()}:${granularity}:${metrics.join(',')}:${groupBy || 'none'}`;
    
    let result = await CacheService.get(cacheKey);
    
    if (!result) {
      result = {};
      
      // Collecte des métriques demandées
      for (const metric of metrics) {
        switch (metric) {
          case 'users':
            result.users = await getUserMetricsByPeriod(start, end, granularity);
            break;
          case 'sessions':
            result.sessions = await getSessionMetricsByPeriod(start, end, granularity);
            break;
          case 'requests':
            result.requests = await getRequestMetricsByPeriod(start, end, granularity);
            break;
          case 'errors':
            result.errors = await getErrorMetricsByPeriod(start, end, granularity);
            break;
          case 'performance':
            result.performance = await getPerformanceMetricsByPeriod(start, end, granularity);
            break;
        }
      }
      
      result.metadata = {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        granularity,
        generatedAt: new Date().toISOString()
      };
      
      // Cache pour 10 minutes
      await CacheService.set(cacheKey, result, 600);
    }
    
    req.logger?.info('Analytics metrics retrieved', {
      userId: req.user.userId,
      metrics,
      period: `${start.toISOString()} - ${end.toISOString()}`
    });
    
    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    req.logger?.error('Error retrieving analytics metrics', {
      error: error.message,
      userId: req.user.userId
    });
    
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des métriques'
    });
  }
});

/**
 * @swagger
 * /api/analytics/real-time:
 *   get:
 *     summary: Métriques en temps réel
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Métriques temps réel
 */
router.get('/real-time', async (req, res) => {
  try {
    // Pas de cache pour les données temps réel
    const realTimeData = {
      activeUsers: await getActiveUsersCount(),
      currentRequests: await getCurrentRequestsPerSecond(),
      systemLoad: getSystemLoad(),
      memoryUsage: getMemoryUsage(),
      responseTime: await getAverageResponseTime(),
      errorRate: await getCurrentErrorRate(),
      cacheHitRate: getCacheHitRate(),
      timestamp: new Date().toISOString()
    };
    
    req.logger?.info('Real-time analytics retrieved', { 
      userId: req.user.userId 
    });
    
    res.json({
      success: true,
      realTime: realTimeData
    });

  } catch (error) {
    req.logger?.error('Error retrieving real-time analytics', {
      error: error.message,
      userId: req.user.userId
    });
    
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des données temps réel'
    });
  }
});

/**
 * @swagger
 * /api/analytics/reports/usage:
 *   get:
 *     summary: Rapport d'utilisation
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Rapport d'utilisation
 */
router.get('/reports/usage', async (req, res) => {
  try {
    const cacheKey = 'analytics_usage_report';
    let report = await CacheService.get(cacheKey);
    
    if (!report) {
      const [
        topPages,
        userActivity,
        deviceStats,
        geographicStats,
        timeDistribution
      ] = await Promise.all([
        getTopPages(),
        getUserActivityPattern(),
        getDeviceStatistics(),
        getGeographicStatistics(),
        getTimeDistribution()
      ]);
      
      report = {
        topPages,
        userActivity,
        devices: deviceStats,
        geography: geographicStats,
        timeDistribution,
        summary: {
          totalSessions: userActivity.totalSessions,
          averageSessionDuration: userActivity.averageSessionDuration,
          bounceRate: userActivity.bounceRate,
          peakHour: timeDistribution.peakHour
        },
        generatedAt: new Date().toISOString()
      };
      
      // Cache pour 1 heure
      await CacheService.set(cacheKey, report, 3600);
    }
    
    req.logger?.info('Usage report retrieved', { 
      userId: req.user.userId 
    });
    
    res.json({
      success: true,
      report
    });

  } catch (error) {
    req.logger?.error('Error generating usage report', {
      error: error.message,
      userId: req.user.userId
    });
    
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la génération du rapport'
    });
  }
});

/**
 * @swagger
 * /api/analytics/reports/performance:
 *   get:
 *     summary: Rapport de performance
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Rapport de performance
 */
router.get('/reports/performance', async (req, res) => {
  try {
    const cacheKey = 'analytics_performance_report';
    let report = await CacheService.get(cacheKey);
    
    if (!report) {
      const [
        responseTimeStats,
        throughputStats,
        errorStats,
        resourceUsage,
        bottlenecks
      ] = await Promise.all([
        getResponseTimeStatistics(),
        getThroughputStatistics(),
        getErrorStatistics(),
        getResourceUsageStatistics(),
        identifyBottlenecks()
      ]);
      
      report = {
        responseTime: responseTimeStats,
        throughput: throughputStats,
        errors: errorStats,
        resources: resourceUsage,
        bottlenecks,
        recommendations: generatePerformanceRecommendations(responseTimeStats, errorStats),
        generatedAt: new Date().toISOString()
      };
      
      // Cache pour 30 minutes
      await CacheService.set(cacheKey, report, 1800);
    }
    
    req.logger?.info('Performance report retrieved', { 
      userId: req.user.userId 
    });
    
    res.json({
      success: true,
      report
    });

  } catch (error) {
    req.logger?.error('Error generating performance report', {
      error: error.message,
      userId: req.user.userId
    });
    
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la génération du rapport de performance'
    });
  }
});

/**
 * Fonctions utilitaires pour collecter les métriques
 */

// Métriques utilisateurs
async function getUserMetrics() {
  try {
    const queries = [
      'SELECT COUNT(*) as total_users FROM users',
      'SELECT COUNT(*) as active_users FROM users WHERE is_active = true',
      'SELECT COUNT(*) as new_users_today FROM users WHERE DATE(created_at) = CURRENT_DATE',
      'SELECT COUNT(*) as new_users_week FROM users WHERE created_at > NOW() - INTERVAL \'7 days\'',
    ];
    
    const results = await Promise.all(
      queries.map(query => DatabaseService.query(query))
    );
    
    return {
      total: parseInt(results[0].rows[0].total_users),
      active: parseInt(results[1].rows[0].active_users),
      newToday: parseInt(results[2].rows[0].new_users_today),
      newThisWeek: parseInt(results[3].rows[0].new_users_week)
    };
  } catch (error) {
    console.error('Error getting user metrics:', error);
    return { total: 0, active: 0, newToday: 0, newThisWeek: 0 };
  }
}

// Métriques de session (simulées pour l'exemple)
async function getSessionMetrics() {
  return {
    total: Math.floor(Math.random() * 1000) + 500,
    active: Math.floor(Math.random() * 100) + 50,
    averageDuration: Math.floor(Math.random() * 300) + 120, // secondes
    bounceRate: (Math.random() * 0.3 + 0.2).toFixed(2) // 20-50%
  };
}

// Métriques de performance système
function getPerformanceMetrics() {
  const memUsage = process.memoryUsage();
  return {
    responseTime: Math.floor(Math.random() * 100) + 50, // ms
    throughput: Math.floor(Math.random() * 500) + 200, // req/s
    memoryUsage: {
      used: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
      total: Math.round(memUsage.heapTotal / 1024 / 1024),
      percentage: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100)
    },
    cpuUsage: (Math.random() * 50 + 20).toFixed(1) // %
  };
}

// Métriques d'erreurs
async function getErrorMetrics() {
  return {
    total: Math.floor(Math.random() * 50),
    rate: (Math.random() * 0.05).toFixed(3), // %
    critical: Math.floor(Math.random() * 5),
    warnings: Math.floor(Math.random() * 20),
    mostCommon: ['ValidationError', 'ConnectionTimeout', 'AuthenticationError']
  };
}

// Métriques système
function getSystemMetrics() {
  return {
    uptime: process.uptime(),
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
    loadAverage: process.platform !== 'win32' ? require('os').loadavg() : [0, 0, 0]
  };
}

// Utilisateurs actifs en temps réel
async function getActiveUsersCount() {
  // Simulation - en production, utiliser Redis ou une table de sessions
  return Math.floor(Math.random() * 50) + 10;
}

// Requêtes par seconde actuelles
async function getCurrentRequestsPerSecond() {
  return Math.floor(Math.random() * 100) + 20;
}

// Charge système
function getSystemLoad() {
  if (process.platform !== 'win32') {
    const os = require('os');
    return {
      load1: os.loadavg()[0].toFixed(2),
      load5: os.loadavg()[1].toFixed(2),
      load15: os.loadavg()[2].toFixed(2)
    };
  }
  return { load1: '0.00', load5: '0.00', load15: '0.00' };
}

// Utilisation mémoire
function getMemoryUsage() {
  const usage = process.memoryUsage();
  return {
    heapUsed: Math.round(usage.heapUsed / 1024 / 1024),
    heapTotal: Math.round(usage.heapTotal / 1024 / 1024),
    external: Math.round(usage.external / 1024 / 1024),
    rss: Math.round(usage.rss / 1024 / 1024)
  };
}

// Temps de réponse moyen
async function getAverageResponseTime() {
  return Math.floor(Math.random() * 200) + 50;
}

// Taux d'erreur actuel
async function getCurrentErrorRate() {
  return (Math.random() * 0.05).toFixed(3);
}

// Taux de succès cache
function getCacheHitRate() {
  const stats = CacheService.getStats();
  return stats.hitRatio || '0%';
}

// Métriques par période
async function getUserMetricsByPeriod(start, end, granularity) {
  // Simulation de données temporelles
  const data = [];
  const current = new Date(start);
  
  while (current <= end) {
    data.push({
      date: current.toISOString(),
      newUsers: Math.floor(Math.random() * 20) + 5,
      activeUsers: Math.floor(Math.random() * 100) + 50
    });
    
    // Avancer selon la granularité
    switch (granularity) {
      case 'hour':
        current.setHours(current.getHours() + 1);
        break;
      case 'day':
        current.setDate(current.getDate() + 1);
        break;
      case 'week':
        current.setDate(current.getDate() + 7);
        break;
      case 'month':
        current.setMonth(current.getMonth() + 1);
        break;
    }
  }
  
  return data;
}

// Autres fonctions de métriques (simulées pour l'exemple)
async function getSessionMetricsByPeriod(start, end, granularity) {
  return await getUserMetricsByPeriod(start, end, granularity);
}

async function getRequestMetricsByPeriod(start, end, granularity) {
  return await getUserMetricsByPeriod(start, end, granularity);
}

async function getErrorMetricsByPeriod(start, end, granularity) {
  return await getUserMetricsByPeriod(start, end, granularity);
}

async function getPerformanceMetricsByPeriod(start, end, granularity) {
  return await getUserMetricsByPeriod(start, end, granularity);
}

// Fonctions pour les rapports
async function getTopPages() {
  return [
    { path: '/dashboard', views: 1250, uniqueViews: 980 },
    { path: '/users', views: 890, uniqueViews: 720 },
    { path: '/analytics', views: 650, uniqueViews: 520 },
    { path: '/settings', views: 420, uniqueViews: 380 }
  ];
}

async function getUserActivityPattern() {
  return {
    totalSessions: 2150,
    averageSessionDuration: 285, // secondes
    bounceRate: 0.23,
    returningUsers: 0.67
  };
}

async function getDeviceStatistics() {
  return {
    desktop: 65,
    mobile: 28,
    tablet: 7
  };
}

async function getGeographicStatistics() {
  return {
    countries: [
      { name: 'France', users: 450, percentage: 45 },
      { name: 'Canada', users: 230, percentage: 23 },
      { name: 'Belgique', users: 180, percentage: 18 },
      { name: 'Suisse', users: 140, percentage: 14 }
    ]
  };
}

async function getTimeDistribution() {
  return {
    peakHour: 14,
    hourlyDistribution: Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      requests: Math.floor(Math.random() * 100) + 20
    }))
  };
}

async function getResponseTimeStatistics() {
  return {
    average: 125,
    median: 95,
    p95: 250,
    p99: 400,
    min: 15,
    max: 2500
  };
}

async function getThroughputStatistics() {
  return {
    average: 150,
    peak: 350,
    requestsPerHour: Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      requests: Math.floor(Math.random() * 200) + 50
    }))
  };
}

async function getErrorStatistics() {
  return {
    total: 45,
    byType: [
      { type: '4xx', count: 30, percentage: 66.7 },
      { type: '5xx', count: 15, percentage: 33.3 }
    ],
    trending: 'down'
  };
}

async function getResourceUsageStatistics() {
  return {
    cpu: { average: 35.2, peak: 78.5 },
    memory: { average: 65.8, peak: 89.2 },
    disk: { usage: 42.1, available: 57.9 },
    network: { inbound: 1.2, outbound: 2.8 } // MB/s
  };
}

async function identifyBottlenecks() {
  return [
    {
      type: 'database',
      severity: 'medium',
      description: 'Requêtes lentes détectées',
      recommendation: 'Optimiser les index'
    },
    {
      type: 'cache',
      severity: 'low',
      description: 'Taux de cache hit inférieur à 90%',
      recommendation: 'Ajuster la stratégie de cache'
    }
  ];
}

function generatePerformanceRecommendations(responseTime, errors) {
  const recommendations = [];
  
  if (responseTime.average > 200) {
    recommendations.push({
      priority: 'high',
      category: 'performance',
      title: 'Optimiser les temps de réponse',
      description: 'Le temps de réponse moyen dépasse 200ms',
      actions: ['Implémenter du cache', 'Optimiser les requêtes DB', 'Utiliser un CDN']
    });
  }
  
  if (errors.total > 100) {
    recommendations.push({
      priority: 'critical',
      category: 'reliability',
      title: 'Réduire le taux d\'erreur',
      description: 'Nombre d\'erreurs élevé détecté',
      actions: ['Audit du code', 'Améliorer la gestion d\'erreurs', 'Tests supplémentaires']
    });
  }
  
  return recommendations;
}

export { router as analyticsRouter };