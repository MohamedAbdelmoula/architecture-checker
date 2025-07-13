/**
 * Service de Base de Données - Framework d'Analyse Technique
 * 
 * Implémente les bonnes pratiques:
 * - Pool de connexions optimisé
 * - Health checks automatiques
 * - Gestion sécurisée des erreurs
 * - Monitoring des performances
 * - Retry logic avec backoff
 */

import pg from 'pg';
const { Pool } = pg;

class DatabaseService {
  constructor() {
    this.pool = null;
    this.isConnected = false;
    this.retryAttempts = 0;
    this.maxRetries = 5;
    this.retryDelay = 1000; // 1 seconde
  }

  /**
   * Initialise la connexion à la base de données
   */
  async initialize() {
    try {
      if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL environment variable is required');
      }

      // Configuration du pool de connexions
      this.pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        min: parseInt(process.env.DATABASE_POOL_MIN) || 2,
        max: parseInt(process.env.DATABASE_POOL_MAX) || 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
        statement_timeout: 30000,
        query_timeout: 30000,
        
        // Configuration SSL pour production
        ssl: process.env.NODE_ENV === 'production' ? {
          rejectUnauthorized: false
        } : false
      });

      // Gestion des événements du pool
      this.pool.on('connect', (client) => {
        console.log('📊 Nouvelle connexion PostgreSQL établie');
      });

      this.pool.on('error', (err, client) => {
        console.error('❌ Erreur PostgreSQL:', err);
        this.isConnected = false;
      });

      this.pool.on('remove', (client) => {
        console.log('📊 Connexion PostgreSQL fermée');
      });

      // Test de connexion initial
      await this.testConnection();
      this.isConnected = true;
      this.retryAttempts = 0;

      console.log('✅ Service de base de données initialisé');
      
    } catch (error) {
      console.error('❌ Erreur lors de l\'initialisation de la base de données:', error);
      
      // Retry logic avec exponential backoff
      if (this.retryAttempts < this.maxRetries) {
        this.retryAttempts++;
        const delay = this.retryDelay * Math.pow(2, this.retryAttempts - 1);
        
        console.log(`🔄 Tentative de reconnexion ${this.retryAttempts}/${this.maxRetries} dans ${delay}ms`);
        
        setTimeout(() => {
          this.initialize();
        }, delay);
        
        return;
      }
      
      throw new Error(`Failed to connect to database after ${this.maxRetries} attempts: ${error.message}`);
    }
  }

  /**
   * Test de connexion à la base de données
   */
  async testConnection() {
    try {
      const client = await this.pool.connect();
      const result = await client.query('SELECT NOW() as current_time, version() as version');
      client.release();
      
      console.log('📊 Connexion DB testée:', result.rows[0].current_time);
      return true;
      
    } catch (error) {
      console.error('❌ Test de connexion DB échoué:', error.message);
      throw error;
    }
  }

  /**
   * Health check de la base de données
   */
  async healthCheck() {
    try {
      if (!this.pool) {
        return false;
      }

      const startTime = Date.now();
      const client = await this.pool.connect();
      
      // Test simple de requête
      const result = await client.query('SELECT 1 as health_check');
      client.release();
      
      const responseTime = Date.now() - startTime;
      
      // Considérer comme unhealthy si > 5 secondes
      if (responseTime > 5000) {
        console.warn(`⚠️ DB health check lent: ${responseTime}ms`);
        return false;
      }
      
      return result.rows[0].health_check === 1;
      
    } catch (error) {
      console.error('❌ DB health check failed:', error.message);
      this.isConnected = false;
      return false;
    }
  }

  /**
   * Exécute une requête avec gestion d'erreurs et métriques
   */
  async query(text, params = []) {
    const startTime = Date.now();
    let client;
    
    try {
      if (!this.pool) {
        throw new Error('Database not initialized');
      }

      client = await this.pool.connect();
      
      // Log de la requête en développement
      if (process.env.NODE_ENV === 'development') {
        console.log('🔍 DB Query:', text.substring(0, 100), params ? `with ${params.length} params` : '');
      }
      
      const result = await client.query(text, params);
      const duration = Date.now() - startTime;
      
      // Métriques de performance
      if (duration > 1000) {
        console.warn(`⚠️ Requête lente détectée: ${duration}ms`);
      }
      
      // Log des métriques
      console.log(`📊 Query executed in ${duration}ms, returned ${result.rowCount} rows`);
      
      return result;
      
    } catch (error) {
      const duration = Date.now() - startTime;
      
      console.error('❌ Database query error:', {
        error: error.message,
        duration,
        query: text.substring(0, 100),
        code: error.code
      });
      
      // Gestion spécifique des erreurs PostgreSQL
      if (error.code === '23505') {
        throw new Error('Duplicate key violation');
      } else if (error.code === '23503') {
        throw new Error('Foreign key constraint violation');
      } else if (error.code === '42P01') {
        throw new Error('Table does not exist');
      }
      
      throw error;
      
    } finally {
      if (client) {
        client.release();
      }
    }
  }

  /**
   * Transaction sécurisée
   */
  async transaction(callback) {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      const result = await callback(client);
      
      await client.query('COMMIT');
      return result;
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
      
    } finally {
      client.release();
    }
  }

  /**
   * Méthodes utilitaires pour requêtes courantes
   */
  
  // Sélection avec pagination
  async selectWithPagination(table, conditions = {}, options = {}) {
    const { page = 1, limit = 10, orderBy = 'id', orderDirection = 'ASC' } = options;
    const offset = (page - 1) * limit;
    
    let whereClause = '';
    let params = [];
    
    if (Object.keys(conditions).length > 0) {
      const conditionStrings = Object.keys(conditions).map((key, index) => {
        params.push(conditions[key]);
        return `${key} = $${index + 1}`;
      });
      whereClause = `WHERE ${conditionStrings.join(' AND ')}`;
    }
    
    const countQuery = `SELECT COUNT(*) FROM ${table} ${whereClause}`;
    const selectQuery = `
      SELECT * FROM ${table} 
      ${whereClause} 
      ORDER BY ${orderBy} ${orderDirection} 
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    
    const [countResult, selectResult] = await Promise.all([
      this.query(countQuery, params),
      this.query(selectQuery, [...params, limit, offset])
    ]);
    
    const total = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(total / limit);
    
    return {
      data: selectResult.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    };
  }

  // Insertion sécurisée
  async insert(table, data) {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map((_, index) => `$${index + 1}`);
    
    const query = `
      INSERT INTO ${table} (${keys.join(', ')}) 
      VALUES (${placeholders.join(', ')}) 
      RETURNING *
    `;
    
    const result = await this.query(query, values);
    return result.rows[0];
  }

  // Mise à jour sécurisée
  async update(table, data, conditions) {
    const dataKeys = Object.keys(data);
    const dataValues = Object.values(data);
    const conditionKeys = Object.keys(conditions);
    const conditionValues = Object.values(conditions);
    
    const setClause = dataKeys.map((key, index) => `${key} = $${index + 1}`).join(', ');
    const whereClause = conditionKeys.map((key, index) => 
      `${key} = $${dataValues.length + index + 1}`
    ).join(' AND ');
    
    const query = `
      UPDATE ${table} 
      SET ${setClause} 
      WHERE ${whereClause} 
      RETURNING *
    `;
    
    const result = await this.query(query, [...dataValues, ...conditionValues]);
    return result.rows[0];
  }

  /**
   * Statistiques du pool de connexions
   */
  getPoolStats() {
    if (!this.pool) {
      return null;
    }
    
    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
      isConnected: this.isConnected
    };
  }

  /**
   * Fermeture propre du service
   */
  async close() {
    try {
      if (this.pool) {
        await this.pool.end();
        this.isConnected = false;
        console.log('✅ Pool de connexions PostgreSQL fermé');
      }
    } catch (error) {
      console.error('❌ Erreur lors de la fermeture du pool DB:', error);
    }
  }
}

// Instance singleton
const databaseService = new DatabaseService();

export { databaseService as DatabaseService };