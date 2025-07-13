/**
 * Service de Cache Redis - Framework d'Analyse Technique
 * 
 * Implémente les bonnes pratiques:
 * - Connexion Redis avec retry logic
 * - Patterns de cache (get/set, invalidation)
 * - Métriques hit/miss ratio
 * - Gestion d'erreurs graceful
 * - Serialization JSON sécurisée
 */

import { createClient } from 'redis';

class CacheService {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.retryAttempts = 0;
    this.maxRetries = 5;
    this.retryDelay = 1000;
    
    // Métriques
    this.metrics = {
      hits: 0,
      misses: 0,
      errors: 0,
      sets: 0,
      deletes: 0
    };
  }

  /**
   * Initialise la connexion Redis
   */
  async initialize() {
    try {
      if (!process.env.REDIS_URL) {
        console.log('⚠️ REDIS_URL non configuré, cache désactivé');
        return;
      }

      // Configuration du client Redis
      this.client = createClient({
        url: process.env.REDIS_URL,
        password: process.env.REDIS_PASSWORD,
        database: parseInt(process.env.REDIS_DB) || 0,
        retry_delay: 1000,
        max_attempts: 3,
        connect_timeout: 5000,
        lazyConnect: true
      });

      // Gestion des événements
      this.client.on('connect', () => {
        console.log('📊 Connexion Redis établie');
        this.isConnected = true;
        this.retryAttempts = 0;
      });

      this.client.on('error', (error) => {
        console.error('❌ Erreur Redis:', error.message);
        this.isConnected = false;
        this.metrics.errors++;
      });

      this.client.on('end', () => {
        console.log('📊 Connexion Redis fermée');
        this.isConnected = false;
      });

      this.client.on('reconnecting', () => {
        console.log('🔄 Reconnexion Redis en cours...');
      });

      // Connexion initiale
      await this.client.connect();
      
      // Test de connexion
      await this.client.ping();
      
      console.log('✅ Service de cache Redis initialisé');
      
    } catch (error) {
      console.error('❌ Erreur lors de l\'initialisation de Redis:', error);
      
      // Retry logic
      if (this.retryAttempts < this.maxRetries) {
        this.retryAttempts++;
        const delay = this.retryDelay * Math.pow(2, this.retryAttempts - 1);
        
        console.log(`🔄 Tentative de reconnexion Redis ${this.retryAttempts}/${this.maxRetries} dans ${delay}ms`);
        
        setTimeout(() => {
          this.initialize();
        }, delay);
        
        return;
      }
      
      console.warn(`⚠️ Redis non disponible après ${this.maxRetries} tentatives, fonctionnement sans cache`);
    }
  }

  /**
   * Health check Redis
   */
  async healthCheck() {
    try {
      if (!this.client || !this.isConnected) {
        return false;
      }

      const startTime = Date.now();
      const pong = await this.client.ping();
      const responseTime = Date.now() - startTime;
      
      // Considérer comme unhealthy si > 2 secondes
      if (responseTime > 2000) {
        console.warn(`⚠️ Redis health check lent: ${responseTime}ms`);
        return false;
      }
      
      return pong === 'PONG';
      
    } catch (error) {
      console.error('❌ Redis health check failed:', error.message);
      this.isConnected = false;
      return false;
    }
  }

  /**
   * Récupère une valeur du cache
   */
  async get(key, options = {}) {
    try {
      if (!this.isAvailable()) {
        this.metrics.misses++;
        return null;
      }

      const startTime = Date.now();
      const value = await this.client.get(this.formatKey(key));
      const duration = Date.now() - startTime;
      
      if (value !== null) {
        this.metrics.hits++;
        
        // Log des requêtes lentes
        if (duration > 100) {
          console.warn(`⚠️ Cache GET lent: ${duration}ms pour ${key}`);
        }
        
        // Désérialisation
        try {
          return JSON.parse(value);
        } catch (parseError) {
          console.warn('⚠️ Erreur de désérialisation cache:', parseError.message);
          // Supprimer la clé corrompue
          await this.delete(key);
          this.metrics.misses++;
          return null;
        }
      }
      
      this.metrics.misses++;
      return null;
      
    } catch (error) {
      console.error('❌ Erreur lors de la récupération du cache:', error.message);
      this.metrics.errors++;
      return null;
    }
  }

  /**
   * Stocke une valeur dans le cache
   */
  async set(key, value, ttl = 3600) {
    try {
      if (!this.isAvailable()) {
        return false;
      }

      const startTime = Date.now();
      
      // Sérialisation sécurisée
      let serializedValue;
      try {
        serializedValue = JSON.stringify(value);
      } catch (serializeError) {
        console.error('❌ Erreur de sérialisation cache:', serializeError.message);
        this.metrics.errors++;
        return false;
      }
      
      // Vérification de la taille (limite 512MB par défaut Redis)
      const sizeInBytes = Buffer.byteLength(serializedValue, 'utf8');
      if (sizeInBytes > 10 * 1024 * 1024) { // 10MB limite
        console.warn(`⚠️ Valeur cache trop grande: ${sizeInBytes} bytes pour ${key}`);
        return false;
      }
      
      // Stockage avec TTL
      await this.client.setEx(this.formatKey(key), ttl, serializedValue);
      
      const duration = Date.now() - startTime;
      this.metrics.sets++;
      
      // Log des opérations lentes
      if (duration > 100) {
        console.warn(`⚠️ Cache SET lent: ${duration}ms pour ${key}`);
      }
      
      return true;
      
    } catch (error) {
      console.error('❌ Erreur lors du stockage en cache:', error.message);
      this.metrics.errors++;
      return false;
    }
  }

  /**
   * Supprime une clé du cache
   */
  async delete(key) {
    try {
      if (!this.isAvailable()) {
        return false;
      }

      const result = await this.client.del(this.formatKey(key));
      this.metrics.deletes++;
      
      return result > 0;
      
    } catch (error) {
      console.error('❌ Erreur lors de la suppression du cache:', error.message);
      this.metrics.errors++;
      return false;
    }
  }

  /**
   * Pattern cache-aside avec fallback
   */
  async getOrSet(key, fetchFunction, ttl = 3600) {
    try {
      // Tentative de récupération du cache
      let value = await this.get(key);
      
      if (value !== null) {
        return value;
      }
      
      // Cache miss, récupération de la valeur
      console.log(`📊 Cache miss pour ${key}, récupération des données`);
      value = await fetchFunction();
      
      // Stockage en cache si la valeur est valide
      if (value !== null && value !== undefined) {
        await this.set(key, value, ttl);
      }
      
      return value;
      
    } catch (error) {
      console.error('❌ Erreur cache-aside:', error.message);
      
      // Fallback: appeler directement la fonction
      try {
        return await fetchFunction();
      } catch (fetchError) {
        console.error('❌ Erreur fallback:', fetchError.message);
        throw fetchError;
      }
    }
  }

  /**
   * Invalidation de cache par pattern
   */
  async deletePattern(pattern) {
    try {
      if (!this.isAvailable()) {
        return 0;
      }

      const keys = await this.client.keys(this.formatKey(pattern));
      
      if (keys.length === 0) {
        return 0;
      }
      
      const result = await this.client.del(keys);
      this.metrics.deletes += result;
      
      console.log(`📊 Invalidé ${result} clés avec le pattern: ${pattern}`);
      return result;
      
    } catch (error) {
      console.error('❌ Erreur lors de l\'invalidation par pattern:', error.message);
      this.metrics.errors++;
      return 0;
    }
  }

  /**
   * Cache pour les listes avec pagination
   */
  async cacheList(key, items, page = 1, limit = 10, ttl = 1800) {
    try {
      const listKey = `${key}:list:${page}:${limit}`;
      return await this.set(listKey, items, ttl);
    } catch (error) {
      console.error('❌ Erreur cache liste:', error.message);
      return false;
    }
  }

  /**
   * Récupération de liste cachée
   */
  async getCachedList(key, page = 1, limit = 10) {
    try {
      const listKey = `${key}:list:${page}:${limit}`;
      return await this.get(listKey);
    } catch (error) {
      console.error('❌ Erreur récupération cache liste:', error.message);
      return null;
    }
  }

  /**
   * Incrémentation atomique (compteurs)
   */
  async increment(key, amount = 1, ttl = null) {
    try {
      if (!this.isAvailable()) {
        return null;
      }

      const formattedKey = this.formatKey(key);
      const result = await this.client.incrBy(formattedKey, amount);
      
      // Définir TTL si spécifié
      if (ttl && result === amount) { // Première création
        await this.client.expire(formattedKey, ttl);
      }
      
      return result;
      
    } catch (error) {
      console.error('❌ Erreur incrémentation cache:', error.message);
      this.metrics.errors++;
      return null;
    }
  }

  /**
   * Définir TTL sur une clé existante
   */
  async expire(key, ttl) {
    try {
      if (!this.isAvailable()) {
        return false;
      }

      const result = await this.client.expire(this.formatKey(key), ttl);
      return result === 1;
      
    } catch (error) {
      console.error('❌ Erreur définition TTL:', error.message);
      this.metrics.errors++;
      return false;
    }
  }

  /**
   * Vérifier l'existence d'une clé
   */
  async exists(key) {
    try {
      if (!this.isAvailable()) {
        return false;
      }

      const result = await this.client.exists(this.formatKey(key));
      return result === 1;
      
    } catch (error) {
      console.error('❌ Erreur vérification existence:', error.message);
      this.metrics.errors++;
      return false;
    }
  }

  /**
   * Utilitaires
   */
  
  // Formatage des clés avec préfixe
  formatKey(key) {
    const prefix = process.env.CACHE_PREFIX || 'app';
    return `${prefix}:${key}`;
  }

  // Vérification de disponibilité
  isAvailable() {
    return this.client && this.isConnected;
  }

  // Calcul du hit ratio
  getHitRatio() {
    const total = this.metrics.hits + this.metrics.misses;
    return total > 0 ? (this.metrics.hits / total * 100).toFixed(2) : 0;
  }

  // Statistiques complètes
  getStats() {
    return {
      ...this.metrics,
      hitRatio: this.getHitRatio() + '%',
      isConnected: this.isConnected,
      retryAttempts: this.retryAttempts
    };
  }

  // Réinitialisation des métriques
  resetMetrics() {
    this.metrics = {
      hits: 0,
      misses: 0,
      errors: 0,
      sets: 0,
      deletes: 0
    };
  }

  /**
   * Fermeture propre du service
   */
  async close() {
    try {
      if (this.client) {
        await this.client.quit();
        this.isConnected = false;
        console.log('✅ Connexion Redis fermée');
      }
    } catch (error) {
      console.error('❌ Erreur lors de la fermeture Redis:', error);
    }
  }
}

// Instance singleton
const cacheService = new CacheService();

export { cacheService as CacheService };