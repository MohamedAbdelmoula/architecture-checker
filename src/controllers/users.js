/**
 * Contrôleur Utilisateurs - Framework d'Analyse Technique
 * 
 * Fonctionnalités:
 * - CRUD utilisateurs avec sécurité
 * - Profil utilisateur et mise à jour
 * - Gestion des permissions
 * - Pagination et filtrage
 * - Cache intelligent
 * - Audit et logs complets
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
const updateProfileSchema = Joi.object({
  firstName: Joi.string().min(2).max(50).optional(),
  lastName: Joi.string().min(2).max(50).optional(),
  phone: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/).optional().allow(''),
  bio: Joi.string().max(500).optional().allow(''),
  preferences: Joi.object({
    theme: Joi.string().valid('light', 'dark', 'auto').optional(),
    language: Joi.string().valid('fr', 'en', 'es').optional(),
    notifications: Joi.object({
      email: Joi.boolean().optional(),
      push: Joi.boolean().optional(),
      sms: Joi.boolean().optional()
    }).optional()
  }).optional()
});

const getUsersSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  search: Joi.string().max(100).optional(),
  sortBy: Joi.string().valid('created_at', 'last_login', 'email', 'first_name').default('created_at'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  status: Joi.string().valid('active', 'inactive', 'all').default('all')
});

/**
 * @swagger
 * /api/users/profile:
 *   get:
 *     summary: Récupère le profil de l'utilisateur connecté
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Profil utilisateur
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 user:
 *                   $ref: '#/components/schemas/User'
 */
router.get('/profile', async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Tentative de récupération depuis le cache
    const cacheKey = `user_profile:${userId}`;
    let user = await CacheService.get(cacheKey);
    
    if (!user) {
      // Cache miss - récupération depuis la base de données
      const result = await DatabaseService.query(`
        SELECT 
          id, email, first_name, last_name, phone, bio,
          preferences, avatar_url, is_active, email_verified,
          created_at, updated_at, last_login
        FROM users 
        WHERE id = $1
      `, [userId]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Utilisateur introuvable'
        });
      }
      
      user = result.rows[0];
      
      // Mise en cache pour 15 minutes
      await CacheService.set(cacheKey, user, 900);
    }
    
    // Formatage de la réponse
    const userProfile = {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      phone: user.phone,
      bio: user.bio,
      avatarUrl: user.avatar_url,
      preferences: user.preferences || {
        theme: 'light',
        language: 'fr',
        notifications: { email: true, push: true, sms: false }
      },
      isActive: user.is_active,
      emailVerified: user.email_verified,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
      lastLogin: user.last_login
    };
    
    req.logger?.info('User profile retrieved', { userId });
    
    res.json({
      success: true,
      user: userProfile
    });

  } catch (error) {
    req.logger?.error('Error retrieving user profile', {
      error: error.message,
      userId: req.user.userId
    });
    
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération du profil'
    });
  }
});

/**
 * @swagger
 * /api/users/profile:
 *   put:
 *     summary: Met à jour le profil de l'utilisateur
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               phone:
 *                 type: string
 *               bio:
 *                 type: string
 *               preferences:
 *                 type: object
 *     responses:
 *       200:
 *         description: Profil mis à jour avec succès
 */
router.put('/profile', async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Validation des données
    const { error, value } = updateProfileSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Données invalides',
        errors: error.details.map(d => ({
          field: d.path.join('.'),
          message: d.message
        }))
      });
    }
    
    const updateData = { ...value };
    
    // Conversion des préférences en JSON
    if (updateData.preferences) {
      updateData.preferences = JSON.stringify(updateData.preferences);
    }
    
    // Ajout de updated_at
    updateData.updated_at = new Date();
    
    // Mise à jour en base de données
    const updatedUser = await DatabaseService.update('users', updateData, { id: userId });
    
    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur introuvable'
      });
    }
    
    // Invalidation du cache
    await CacheService.delete(`user_profile:${userId}`);
    
    // Log de l'action
    req.logger?.info('User profile updated', {
      userId,
      updatedFields: Object.keys(value),
      ip: req.ip
    });
    
    res.json({
      success: true,
      message: 'Profil mis à jour avec succès',
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        firstName: updatedUser.first_name,
        lastName: updatedUser.last_name,
        phone: updatedUser.phone,
        bio: updatedUser.bio,
        preferences: typeof updatedUser.preferences === 'string' 
          ? JSON.parse(updatedUser.preferences) 
          : updatedUser.preferences,
        updatedAt: updatedUser.updated_at
      }
    });

  } catch (error) {
    req.logger?.error('Error updating user profile', {
      error: error.message,
      userId: req.user.userId
    });
    
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la mise à jour du profil'
    });
  }
});

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: Liste les utilisateurs (admin seulement)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, inactive, all]
 *     responses:
 *       200:
 *         description: Liste des utilisateurs
 */
router.get('/', async (req, res) => {
  try {
    // Vérification des permissions admin (à implémenter selon vos besoins)
    // Pour l'exemple, on autorise tous les utilisateurs authentifiés
    
    // Validation des paramètres de requête
    const { error, value } = getUsersSchema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Paramètres invalides'
      });
    }
    
    const { page, limit, search, sortBy, sortOrder, status } = value;
    
    // Construction de la clé de cache
    const cacheKey = `users_list:${page}:${limit}:${search || 'all'}:${sortBy}:${sortOrder}:${status}`;
    
    // Tentative de récupération depuis le cache
    let result = await CacheService.get(cacheKey);
    
    if (!result) {
      // Construction de la requête SQL
      let whereConditions = [];
      let queryParams = [];
      let paramIndex = 1;
      
      // Filtrage par statut
      if (status !== 'all') {
        whereConditions.push(`is_active = $${paramIndex}`);
        queryParams.push(status === 'active');
        paramIndex++;
      }
      
      // Recherche textuelle
      if (search) {
        whereConditions.push(`(
          LOWER(first_name) LIKE LOWER($${paramIndex}) OR 
          LOWER(last_name) LIKE LOWER($${paramIndex}) OR 
          LOWER(email) LIKE LOWER($${paramIndex})
        )`);
        queryParams.push(`%${search}%`);
        paramIndex++;
      }
      
      const whereClause = whereConditions.length > 0 
        ? `WHERE ${whereConditions.join(' AND ')}`
        : '';
      
      // Requête pour le nombre total
      const countQuery = `
        SELECT COUNT(*) as total 
        FROM users 
        ${whereClause}
      `;
      
      // Requête pour les données
      const dataQuery = `
        SELECT 
          id, email, first_name, last_name, is_active, 
          email_verified, created_at, last_login
        FROM users 
        ${whereClause}
        ORDER BY ${sortBy} ${sortOrder.toUpperCase()}
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;
      
      queryParams.push(limit, (page - 1) * limit);
      
      // Exécution des requêtes
      const [countResult, dataResult] = await Promise.all([
        DatabaseService.query(countQuery, queryParams.slice(0, -2)),
        DatabaseService.query(dataQuery, queryParams)
      ]);
      
      const total = parseInt(countResult.rows[0].total);
      const totalPages = Math.ceil(total / limit);
      
      result = {
        users: dataResult.rows.map(user => ({
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          isActive: user.is_active,
          emailVerified: user.email_verified,
          createdAt: user.created_at,
          lastLogin: user.last_login
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      };
      
      // Mise en cache pour 5 minutes
      await CacheService.set(cacheKey, result, 300);
    }
    
    req.logger?.info('Users list retrieved', {
      userId: req.user.userId,
      page,
      limit,
      search: search || 'none',
      total: result.pagination.total
    });
    
    res.json({
      success: true,
      ...result
    });

  } catch (error) {
    req.logger?.error('Error retrieving users list', {
      error: error.message,
      userId: req.user.userId
    });
    
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des utilisateurs'
    });
  }
});

/**
 * @swagger
 * /api/users/{id}:
 *   get:
 *     summary: Récupère un utilisateur par ID
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Utilisateur trouvé
 *       404:
 *         description: Utilisateur introuvable
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const requestingUserId = req.user.userId;
    
    // Vérification: un utilisateur ne peut voir que son propre profil
    // sauf s'il est admin (à implémenter selon vos besoins)
    if (id !== requestingUserId) {
      req.logger?.warn('Unauthorized user access attempt', {
        requestingUserId,
        targetUserId: id,
        ip: req.ip
      });
      
      return res.status(403).json({
        success: false,
        message: 'Accès non autorisé'
      });
    }
    
    // Utilisation de la route profile pour l'utilisateur connecté
    if (id === requestingUserId) {
      return router.handle({ ...req, url: '/profile', method: 'GET' }, res);
    }

  } catch (error) {
    req.logger?.error('Error retrieving user by ID', {
      error: error.message,
      userId: req.user.userId,
      targetId: req.params.id
    });
    
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération de l\'utilisateur'
    });
  }
});

/**
 * @swagger
 * /api/users/{id}/deactivate:
 *   patch:
 *     summary: Désactive un compte utilisateur (admin seulement)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Compte désactivé
 */
router.patch('/:id/deactivate', async (req, res) => {
  try {
    const { id } = req.params;
    const requestingUserId = req.user.userId;
    
    // Vérification: un utilisateur ne peut pas se désactiver lui-même
    if (id === requestingUserId) {
      return res.status(400).json({
        success: false,
        message: 'Vous ne pouvez pas désactiver votre propre compte'
      });
    }
    
    // Ici, vous devriez vérifier les permissions admin
    // Pour l'exemple, on autorise tous les utilisateurs
    
    // Désactivation du compte
    const updatedUser = await DatabaseService.update(
      'users',
      { is_active: false, updated_at: new Date() },
      { id }
    );
    
    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur introuvable'
      });
    }
    
    // Invalidation du cache
    await CacheService.deletePattern(`user*${id}*`);
    await CacheService.deletePattern('users_list*');
    
    // Log de l'action
    req.logger?.info('User account deactivated', {
      adminUserId: requestingUserId,
      deactivatedUserId: id,
      ip: req.ip
    });
    
    res.json({
      success: true,
      message: 'Compte utilisateur désactivé avec succès'
    });

  } catch (error) {
    req.logger?.error('Error deactivating user account', {
      error: error.message,
      adminUserId: req.user.userId,
      targetUserId: req.params.id
    });
    
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la désactivation du compte'
    });
  }
});

/**
 * @swagger
 * /api/users/stats:
 *   get:
 *     summary: Statistiques des utilisateurs
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Statistiques utilisateurs
 */
router.get('/stats', async (req, res) => {
  try {
    // Tentative de récupération depuis le cache
    const cacheKey = 'user_stats';
    let stats = await CacheService.get(cacheKey);
    
    if (!stats) {
      // Calcul des statistiques
      const queries = [
        'SELECT COUNT(*) as total FROM users',
        'SELECT COUNT(*) as active FROM users WHERE is_active = true',
        'SELECT COUNT(*) as verified FROM users WHERE email_verified = true',
        'SELECT COUNT(*) as recent FROM users WHERE created_at > NOW() - INTERVAL \'7 days\'',
        'SELECT COUNT(*) as logged_recently FROM users WHERE last_login > NOW() - INTERVAL \'30 days\''
      ];
      
      const results = await Promise.all(
        queries.map(query => DatabaseService.query(query))
      );
      
      stats = {
        total: parseInt(results[0].rows[0].total),
        active: parseInt(results[1].rows[0].active),
        verified: parseInt(results[2].rows[0].verified),
        recentRegistrations: parseInt(results[3].rows[0].recent),
        activeLastMonth: parseInt(results[4].rows[0].logged_recently)
      };
      
      // Calcul des pourcentages
      stats.activePercentage = stats.total > 0 
        ? Math.round((stats.active / stats.total) * 100) 
        : 0;
      
      stats.verifiedPercentage = stats.total > 0 
        ? Math.round((stats.verified / stats.total) * 100) 
        : 0;
      
      // Mise en cache pour 30 minutes
      await CacheService.set(cacheKey, stats, 1800);
    }
    
    req.logger?.info('User stats retrieved', { userId: req.user.userId });
    
    res.json({
      success: true,
      stats
    });

  } catch (error) {
    req.logger?.error('Error retrieving user stats', {
      error: error.message,
      userId: req.user.userId
    });
    
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des statistiques'
    });
  }
});

export { router as userRouter };