// Configuration complète de monitoring et observabilité
import promClient from 'prom-client';
import winston from 'winston';
import { ElasticsearchTransport } from 'winston-elasticsearch';

// Configuration des métriques Prometheus
class MetricsCollector {
  constructor() {
    // Registre par défaut
    this.register = promClient.register;
    
    // Métriques système par défaut
    promClient.collectDefaultMetrics({ register: this.register });
    
    // Métriques applicatives personnalisées
    this.httpRequestDuration = new promClient.Histogram({
      name: 'http_request_duration_seconds',
      help: 'Durée des requêtes HTTP en secondes',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.1, 0.5, 1, 2, 5, 10]
    });
    
    this.httpRequestTotal = new promClient.Counter({
      name: 'http_requests_total',
      help: 'Nombre total de requêtes HTTP',
      labelNames: ['method', 'route', 'status_code']
    });
    
    this.activeConnections = new promClient.Gauge({
      name: 'active_connections',
      help: 'Nombre de connexions actives'
    });
    
    this.databaseConnectionPool = new promClient.Gauge({
      name: 'database_connection_pool_size',
      help: 'Taille du pool de connexions BD',
      labelNames: ['database', 'status']
    });
    
    this.cacheHitRate = new promClient.Histogram({
      name: 'cache_hit_rate',
      help: 'Taux de réussite du cache',
      labelNames: ['cache_type'],
      buckets: [0.5, 0.7, 0.8, 0.9, 0.95, 0.99, 1.0]
    });
    
    // Métriques business
    this.userActions = new promClient.Counter({
      name: 'user_actions_total',
      help: 'Actions utilisateur totales',
      labelNames: ['action_type', 'user_type']
    });
    
    this.businessTransactions = new promClient.Counter({
      name: 'business_transactions_total',
      help: 'Transactions business totales',
      labelNames: ['transaction_type', 'status']
    });
    
    this.revenue = new promClient.Gauge({
      name: 'revenue_current',
      help: 'Revenus actuels',
      labelNames: ['currency', 'period']
    });
  }
  
  // Middleware Express pour collecter métriques HTTP
  expressMiddleware() {
    return (req, res, next) => {
      const start = Date.now();
      
      res.on('finish', () => {
        const duration = (Date.now() - start) / 1000;
        const labels = {
          method: req.method,
          route: req.route?.path || req.path,
          status_code: res.statusCode
        };
        
        this.httpRequestDuration.observe(labels, duration);
        this.httpRequestTotal.inc(labels);
      });
      
      next();
    };
  }
  
  // Métriques pour les erreurs
  recordError(error, context = {}) {
    if (!this.errorCounter) {
      this.errorCounter = new promClient.Counter({
        name: 'application_errors_total',
        help: 'Erreurs applicatives totales',
        labelNames: ['error_type', 'severity', 'component']
      });
    }
    
    this.errorCounter.inc({
      error_type: error.constructor.name,
      severity: context.severity || 'error',
      component: context.component || 'unknown'
    });
  }
  
  // Endpoint pour exposer les métriques
  getMetrics() {
    return this.register.metrics();
  }
}

// Configuration des logs structurés
class LoggerConfig {
  constructor() {
    // Format personnalisé pour les logs structurés
    const logFormat = winston.format.combine(
      winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss.SSS'
      }),
      winston.format.errors({ stack: true }),
      winston.format.json(),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        return JSON.stringify({
          '@timestamp': timestamp,
          level: level.toUpperCase(),
          message,
          correlation_id: meta.correlationId,
          user_id: meta.userId,
          request_id: meta.requestId,
          component: meta.component,
          ...meta
        });
      })
    );
    
    // Configuration des transports
    const transports = [
      // Console pour développement
      new winston.transports.Console({
        level: process.env.LOG_LEVEL || 'info',
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple()
        )
      }),
      
      // Fichiers pour production
      new winston.transports.File({
        filename: 'logs/error.log',
        level: 'error',
        format: logFormat,
        maxsize: 50 * 1024 * 1024, // 50MB
        maxFiles: 10
      }),
      
      new winston.transports.File({
        filename: 'logs/combined.log',
        format: logFormat,
        maxsize: 50 * 1024 * 1024,
        maxFiles: 10
      })
    ];
    
    // Transport Elasticsearch pour production
    if (process.env.ELASTICSEARCH_URL) {
      transports.push(
        new ElasticsearchTransport({
          level: 'info',
          clientOpts: {
            node: process.env.ELASTICSEARCH_URL,
            auth: {
              username: process.env.ELASTICSEARCH_USERNAME,
              password: process.env.ELASTICSEARCH_PASSWORD
            }
          },
          index: `app-logs-${new Date().toISOString().slice(0, 7)}` // Index mensuel
        })
      );
    }
    
    // Créer le logger
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: logFormat,
      transports,
      // Gestion des exceptions non capturées
      exceptionHandlers: [
        new winston.transports.File({ filename: 'logs/exceptions.log' })
      ],
      rejectionHandlers: [
        new winston.transports.File({ filename: 'logs/rejections.log' })
      ]
    });
  }
  
  // Middleware pour ajouter contexte aux logs
  expressMiddleware() {
    return (req, res, next) => {
      const correlationId = req.headers['x-correlation-id'] || 
                           req.headers['x-request-id'] || 
                           Math.random().toString(36).substring(7);
      
      req.correlationId = correlationId;
      res.setHeader('X-Correlation-ID', correlationId);
      
      // Logger enrichi avec contexte
      req.logger = this.logger.child({
        correlationId,
        requestId: req.id,
        userId: req.user?.id,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      // Log de la requête
      req.logger.info('Request received', {
        method: req.method,
        url: req.url,
        query: req.query
      });
      
      next();
    };
  }
  
  getLogger() {
    return this.logger;
  }
}

// Configuration des alertes
class AlertManager {
  constructor(logger, metrics) {
    this.logger = logger;
    this.metrics = metrics;
    this.alertRules = new Map();
    this.alertHistory = new Map();
  }
  
  // Définir une règle d'alerte
  addRule(name, condition, threshold, severity = 'warning') {
    this.alertRules.set(name, {
      condition,
      threshold,
      severity,
      cooldown: 300000, // 5 minutes
      lastTriggered: 0
    });
  }
  
  // Vérifier les alertes
  checkAlerts() {
    const now = Date.now();
    
    for (const [name, rule] of this.alertRules) {
      try {
        const value = rule.condition();
        
        if (value > rule.threshold && 
            (now - rule.lastTriggered) > rule.cooldown) {
          
          this.triggerAlert(name, value, rule);
          rule.lastTriggered = now;
        }
      } catch (error) {
        this.logger.error('Erreur lors de la vérification d\'alerte', {
          rule: name,
          error: error.message
        });
      }
    }
  }
  
  // Déclencher une alerte
  async triggerAlert(name, value, rule) {
    const alert = {
      name,
      value,
      threshold: rule.threshold,
      severity: rule.severity,
      timestamp: new Date().toISOString(),
      host: process.env.HOSTNAME || 'unknown'
    };
    
    this.logger.error('ALERTE DÉCLENCHÉE', alert);
    
    // Envoyer notification (Slack, email, etc.)
    await this.sendNotification(alert);
    
    // Enregistrer dans l'historique
    if (!this.alertHistory.has(name)) {
      this.alertHistory.set(name, []);
    }
    this.alertHistory.get(name).push(alert);
  }
  
  // Envoyer notification
  async sendNotification(alert) {
    if (process.env.SLACK_WEBHOOK_URL) {
      try {
        const payload = {
          text: `🚨 ALERTE ${alert.severity.toUpperCase()}`,
          attachments: [{
            color: alert.severity === 'critical' ? 'danger' : 'warning',
            fields: [
              { title: 'Règle', value: alert.name, short: true },
              { title: 'Valeur', value: alert.value, short: true },
              { title: 'Seuil', value: alert.threshold, short: true },
              { title: 'Host', value: alert.host, short: true }
            ],
            ts: Math.floor(Date.now() / 1000)
          }]
        };
        
        await fetch(process.env.SLACK_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } catch (error) {
        this.logger.error('Erreur envoi notification Slack', { error: error.message });
      }
    }
  }
}

// Configuration du health check
class HealthChecker {
  constructor() {
    this.checks = new Map();
  }
  
  // Ajouter un check de santé
  addCheck(name, checkFunction, timeout = 5000) {
    this.checks.set(name, { checkFunction, timeout });
  }
  
  // Exécuter tous les checks
  async runChecks() {
    const results = {};
    const promises = [];
    
    for (const [name, { checkFunction, timeout }] of this.checks) {
      const promise = Promise.race([
        checkFunction(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), timeout)
        )
      ]).then(
        result => ({ name, status: 'healthy', result }),
        error => ({ name, status: 'unhealthy', error: error.message })
      );
      
      promises.push(promise);
    }
    
    const checkResults = await Promise.all(promises);
    
    checkResults.forEach(({ name, status, result, error }) => {
      results[name] = { status, result, error };
    });
    
    const overallStatus = Object.values(results).every(r => r.status === 'healthy') 
      ? 'healthy' : 'unhealthy';
    
    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      checks: results
    };
  }
  
  // Endpoint health check
  expressEndpoint() {
    return async (req, res) => {
      try {
        const health = await this.runChecks();
        const statusCode = health.status === 'healthy' ? 200 : 503;
        res.status(statusCode).json(health);
      } catch (error) {
        res.status(500).json({
          status: 'error',
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    };
  }
}

// Configuration principale
export class MonitoringSetup {
  constructor() {
    this.metrics = new MetricsCollector();
    this.logger = new LoggerConfig();
    this.alerts = new AlertManager(this.logger.getLogger(), this.metrics);
    this.health = new HealthChecker();
    
    this.setupDefaultAlerts();
    this.setupDefaultHealthChecks();
    this.startAlertMonitoring();
  }
  
  setupDefaultAlerts() {
    // Alerte sur taux d'erreur élevé
    this.alerts.addRule(
      'high_error_rate',
      () => this.getErrorRate(),
      0.05, // 5%
      'critical'
    );
    
    // Alerte sur temps de réponse élevé
    this.alerts.addRule(
      'high_response_time',
      () => this.getAverageResponseTime(),
      2000, // 2 secondes
      'warning'
    );
    
    // Alerte sur utilisation mémoire
    this.alerts.addRule(
      'high_memory_usage',
      () => process.memoryUsage().heapUsed / process.memoryUsage().heapTotal,
      0.9, // 90%
      'warning'
    );
  }
  
  setupDefaultHealthChecks() {
    // Check base de données
    this.health.addCheck('database', async () => {
      // Implémenter check DB
      return { latency: 50, connections: 10 };
    });
    
    // Check Redis
    this.health.addCheck('redis', async () => {
      // Implémenter check Redis
      return { status: 'connected' };
    });
    
    // Check services externes
    this.health.addCheck('external_api', async () => {
      // Implémenter check API externe
      return { status: 'available' };
    });
  }
  
  startAlertMonitoring() {
    // Vérifier les alertes toutes les minutes
    setInterval(() => {
      this.alerts.checkAlerts();
    }, 60000);
  }
  
  getErrorRate() {
    // Calculer le taux d'erreur basé sur les métriques
    // Implémentation dépendante des métriques collectées
    return 0.02; // 2% par défaut
  }
  
  getAverageResponseTime() {
    // Calculer le temps de réponse moyen
    // Implémentation dépendante des métriques collectées
    return 500; // 500ms par défaut
  }
  
  // Middleware Express complet
  expressMiddleware() {
    return [
      this.logger.expressMiddleware(),
      this.metrics.expressMiddleware()
    ];
  }
  
  // Endpoints monitoring
  setupEndpoints(app) {
    // Métriques Prometheus
    app.get('/metrics', (req, res) => {
      res.set('Content-Type', this.metrics.register.contentType);
      res.end(this.metrics.getMetrics());
    });
    
    // Health check
    app.get('/health', this.health.expressEndpoint());
    
    // Informations système
    app.get('/info', (req, res) => {
      res.json({
        version: process.env.npm_package_version,
        node: process.version,
        uptime: process.uptime(),
        environment: process.env.NODE_ENV,
        timestamp: new Date().toISOString()
      });
    });
  }
}

// Export
export { MetricsCollector, LoggerConfig, AlertManager, HealthChecker };