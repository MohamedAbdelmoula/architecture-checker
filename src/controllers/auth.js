/**
 * Contrôleur d'Authentification - Framework d'Analyse Technique
 * 
 * Implémente les bonnes pratiques de sécurité:
 * - JWT avec refresh tokens
 * - Hashage sécurisé des mots de passe (bcrypt)
 * - Validation robuste des entrées (Joi)
 * - Rate limiting et protection brute force
 * - Logs de sécurité complets
 * - Gestion sécurisée des sessions
 */

import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Joi from 'joi';
import { v4 as uuidv4 } from 'uuid';

import { DatabaseService } from '../services/database.js';
import { CacheService } from '../services/cache.js';
import { EmailService } from '../services/email.js';
import { jwtValidation } from '../config/security-config.js';

const router = express.Router();

// Schémas de validation Joi
const registerSchema = Joi.object({
  email: Joi.string().email().required().max(255),
  password: Joi.string().min(8).max(128).required()
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .messages({
      'string.pattern.base': 'Le mot de passe doit contenir au moins une minuscule, une majuscule, un chiffre et un caractère spécial'
    }),
  firstName: Joi.string().min(2).max(50).required(),
  lastName: Joi.string().min(2).max(50).required(),
  acceptTerms: Joi.boolean().valid(true).required()
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
  rememberMe: Joi.boolean().default(false)
});

const resetPasswordSchema = Joi.object({
  email: Joi.string().email().required()
});

const changePasswordSchema = Joi.object({
  token: Joi.string().required(),
  newPassword: Joi.string().min(8).max(128).required()
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
});

/**
 * @swagger
 * components:
 *   schemas:
 *     User:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         email:
 *           type: string
 *         firstName:
 *           type: string
 *         lastName:
 *           type: string
 *         createdAt:
 *           type: string
 *           format: date-time
 *     AuthResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         message:
 *           type: string
 *         user:
 *           $ref: '#/components/schemas/User'
 *         tokens:
 *           type: object
 *           properties:
 *             accessToken:
 *               type: string
 *             refreshToken:
 *               type: string
 */

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Inscription d'un nouvel utilisateur
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *               - firstName
 *               - lastName
 *               - acceptTerms
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 8
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               acceptTerms:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Utilisateur créé avec succès
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       400:
 *         description: Données invalides
 *       409:
 *         description: Email déjà utilisé
 */
router.post('/register', async (req, res) => {
  const startTime = Date.now();
  
  try {
    // Validation des données
    const { error, value } = registerSchema.validate(req.body);
    if (error) {
      req.logger?.warn('Validation failed for registration', {
        errors: error.details.map(d => d.message),
        ip: req.ip
      });
      
      return res.status(400).json({
        success: false,
        message: 'Données invalides',
        errors: error.details.map(d => ({
          field: d.path.join('.'),
          message: d.message
        }))
      });
    }

    const { email, password, firstName, lastName } = value;

    // Vérification de l'unicité de l'email
    const existingUser = await DatabaseService.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      req.logger?.warn('Registration attempt with existing email', {
        email: email.toLowerCase(),
        ip: req.ip
      });
      
      return res.status(409).json({
        success: false,
        message: 'Cette adresse email est déjà utilisée'
      });
    }

    // Vérification du rate limiting pour les inscriptions
    const registrationKey = `registration_attempts:${req.ip}`;
    const attempts = await CacheService.increment(registrationKey, 1, 3600); // 1 heure
    
    if (attempts > 5) {
      req.logger?.warn('Too many registration attempts', {
        ip: req.ip,
        attempts
      });
      
      return res.status(429).json({
        success: false,
        message: 'Trop de tentatives d\'inscription. Réessayez plus tard.'
      });
    }

    // Hashage du mot de passe
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Création de l'utilisateur
    const userId = uuidv4();
    const user = await DatabaseService.query(`
      INSERT INTO users (id, email, password_hash, first_name, last_name, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      RETURNING id, email, first_name, last_name, created_at
    `, [userId, email.toLowerCase(), hashedPassword, firstName, lastName]);

    const newUser = user.rows[0];

    // Génération des tokens
    const tokens = generateTokens(newUser);

    // Stockage du refresh token
    await storeRefreshToken(newUser.id, tokens.refreshToken);

    // Envoi de l'email de bienvenue (asynchrone)
    EmailService.sendWelcomeEmail(email, firstName).catch(error => {
      req.logger?.error('Failed to send welcome email', { error: error.message });
    });

    // Log de succès
    req.logger?.info('User registered successfully', {
      userId: newUser.id,
      email: email.toLowerCase(),
      ip: req.ip,
      duration: Date.now() - startTime
    });

    // Réponse de succès (sans le mot de passe)
    res.status(201).json({
      success: true,
      message: 'Compte créé avec succès',
      user: {
        id: newUser.id,
        email: newUser.email,
        firstName: newUser.first_name,
        lastName: newUser.last_name,
        createdAt: newUser.created_at
      },
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken
      }
    });

  } catch (error) {
    req.logger?.error('Registration error', {
      error: error.message,
      stack: error.stack,
      ip: req.ip,
      duration: Date.now() - startTime
    });

    res.status(500).json({
      success: false,
      message: 'Erreur lors de la création du compte'
    });
  }
});

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Connexion utilisateur
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *               rememberMe:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Connexion réussie
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       401:
 *         description: Identifiants invalides
 *       429:
 *         description: Trop de tentatives
 */
router.post('/login', async (req, res) => {
  const startTime = Date.now();
  
  try {
    // Validation des données
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Données invalides'
      });
    }

    const { email, password, rememberMe } = value;

    // Vérification du rate limiting pour les tentatives de connexion
    const loginKey = `login_attempts:${req.ip}:${email.toLowerCase()}`;
    const attempts = await CacheService.get(loginKey) || 0;
    
    if (attempts >= 5) {
      req.logger?.warn('Too many login attempts', {
        email: email.toLowerCase(),
        ip: req.ip,
        attempts
      });
      
      return res.status(429).json({
        success: false,
        message: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.'
      });
    }

    // Recherche de l'utilisateur
    const userResult = await DatabaseService.query(`
      SELECT id, email, password_hash, first_name, last_name, is_active, last_login
      FROM users 
      WHERE email = $1
    `, [email.toLowerCase()]);

    if (userResult.rows.length === 0) {
      // Incrémenter les tentatives même si l'utilisateur n'existe pas
      await CacheService.increment(loginKey, 1, 900); // 15 minutes
      
      req.logger?.warn('Login attempt with non-existent email', {
        email: email.toLowerCase(),
        ip: req.ip
      });
      
      return res.status(401).json({
        success: false,
        message: 'Identifiants invalides'
      });
    }

    const user = userResult.rows[0];

    // Vérification si le compte est actif
    if (!user.is_active) {
      req.logger?.warn('Login attempt with inactive account', {
        userId: user.id,
        email: email.toLowerCase(),
        ip: req.ip
      });
      
      return res.status(401).json({
        success: false,
        message: 'Compte désactivé. Contactez l\'administrateur.'
      });
    }

    // Vérification du mot de passe
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    
    if (!isPasswordValid) {
      // Incrémenter les tentatives d'échec
      await CacheService.increment(loginKey, 1, 900); // 15 minutes
      
      req.logger?.warn('Login attempt with invalid password', {
        userId: user.id,
        email: email.toLowerCase(),
        ip: req.ip,
        attempts: attempts + 1
      });
      
      return res.status(401).json({
        success: false,
        message: 'Identifiants invalides'
      });
    }

    // Connexion réussie - réinitialiser les tentatives
    await CacheService.delete(loginKey);

    // Génération des tokens
    const tokenExpiry = rememberMe ? '30d' : '7d';
    const tokens = generateTokens(user, tokenExpiry);

    // Stockage du refresh token
    await storeRefreshToken(user.id, tokens.refreshToken);

    // Mise à jour de la dernière connexion
    await DatabaseService.query(
      'UPDATE users SET last_login = NOW() WHERE id = $1',
      [user.id]
    );

    // Log de succès
    req.logger?.info('User logged in successfully', {
      userId: user.id,
      email: email.toLowerCase(),
      ip: req.ip,
      rememberMe,
      duration: Date.now() - startTime
    });

    // Réponse de succès
    res.json({
      success: true,
      message: 'Connexion réussie',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        lastLogin: user.last_login
      },
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken
      }
    });

  } catch (error) {
    req.logger?.error('Login error', {
      error: error.message,
      stack: error.stack,
      ip: req.ip,
      duration: Date.now() - startTime
    });

    res.status(500).json({
      success: false,
      message: 'Erreur lors de la connexion'
    });
  }
});

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     summary: Renouvellement du token d'accès
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Token renouvelé avec succès
 *       401:
 *         description: Refresh token invalide
 */
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token requis'
      });
    }

    // Vérification du refresh token
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    
    // Vérification en base de données
    const tokenResult = await DatabaseService.query(
      'SELECT user_id FROM refresh_tokens WHERE token = $1 AND expires_at > NOW()',
      [refreshToken]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token invalide ou expiré'
      });
    }

    // Récupération des données utilisateur
    const userResult = await DatabaseService.query(
      'SELECT id, email, first_name, last_name FROM users WHERE id = $1 AND is_active = true',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Utilisateur introuvable ou inactif'
      });
    }

    const user = userResult.rows[0];

    // Génération d'un nouveau token d'accès
    const newTokens = generateTokens(user);

    // Rotation du refresh token
    await DatabaseService.transaction(async (client) => {
      // Supprimer l'ancien refresh token
      await client.query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);
      
      // Stocker le nouveau refresh token
      await client.query(`
        INSERT INTO refresh_tokens (user_id, token, expires_at, created_at)
        VALUES ($1, $2, NOW() + INTERVAL '30 days', NOW())
      `, [user.id, newTokens.refreshToken]);
    });

    res.json({
      success: true,
      tokens: {
        accessToken: newTokens.accessToken,
        refreshToken: newTokens.refreshToken
      }
    });

  } catch (error) {
    req.logger?.error('Token refresh error', { error: error.message });
    
    res.status(401).json({
      success: false,
      message: 'Token invalide'
    });
  }
});

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Déconnexion utilisateur
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Déconnexion réussie
 */
router.post('/logout', jwtValidation, async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    // Supprimer le refresh token si fourni
    if (refreshToken) {
      await DatabaseService.query(
        'DELETE FROM refresh_tokens WHERE token = $1',
        [refreshToken]
      );
    }

    // Log de déconnexion
    req.logger?.info('User logged out', {
      userId: req.user.userId,
      ip: req.ip
    });

    res.json({
      success: true,
      message: 'Déconnexion réussie'
    });

  } catch (error) {
    req.logger?.error('Logout error', { error: error.message });
    
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la déconnexion'
    });
  }
});

/**
 * Fonctions utilitaires
 */

// Génération des tokens JWT
function generateTokens(user, accessTokenExpiry = '15m') {
  const payload = {
    userId: user.id,
    email: user.email,
    firstName: user.first_name,
    lastName: user.last_name
  };

  const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: accessTokenExpiry,
    issuer: 'technical-analysis-app',
    audience: 'technical-analysis-users'
  });

  const refreshToken = jwt.sign(
    { userId: user.id },
    process.env.JWT_SECRET,
    {
      expiresIn: '30d',
      issuer: 'technical-analysis-app',
      audience: 'technical-analysis-refresh'
    }
  );

  return { accessToken, refreshToken };
}

// Stockage du refresh token
async function storeRefreshToken(userId, token) {
  await DatabaseService.query(`
    INSERT INTO refresh_tokens (user_id, token, expires_at, created_at)
    VALUES ($1, $2, NOW() + INTERVAL '30 days', NOW())
  `, [userId, token]);
}

export { router as authRouter };