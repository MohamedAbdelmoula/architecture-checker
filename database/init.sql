-- Script d'initialisation de la base de données
-- Framework d'Analyse Technique - Technical Analysis Application

-- Configuration PostgreSQL pour performances
SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

-- Création des extensions nécessaires
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
CREATE EXTENSION IF NOT EXISTS "btree_gin";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- Fonction pour les timestamps automatiques
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- ================================
-- Table des utilisateurs
-- ================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    bio TEXT,
    avatar_url VARCHAR(500),
    preferences JSONB DEFAULT '{"theme": "light", "language": "fr", "notifications": {"email": true, "push": true, "sms": false}}',
    is_active BOOLEAN DEFAULT true,
    email_verified BOOLEAN DEFAULT false,
    email_verification_token VARCHAR(255),
    password_reset_token VARCHAR(255),
    password_reset_expires TIMESTAMP WITH TIME ZONE,
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index pour les performances
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_active ON users(is_active);
CREATE INDEX idx_users_created_at ON users(created_at);
CREATE INDEX idx_users_last_login ON users(last_login);
CREATE INDEX idx_users_preferences ON users USING GIN(preferences);

-- Trigger pour updated_at
CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON users 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- ================================
-- Table des refresh tokens
-- ================================
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(500) NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index pour les performances
CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token ON refresh_tokens(token);
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);

-- ================================
-- Table des sessions
-- ================================
CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    session_token VARCHAR(255) NOT NULL UNIQUE,
    ip_address INET,
    user_agent TEXT,
    device_info JSONB,
    location_info JSONB,
    is_active BOOLEAN DEFAULT true,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index pour les performances
CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_token ON user_sessions(session_token);
CREATE INDEX idx_user_sessions_active ON user_sessions(is_active);
CREATE INDEX idx_user_sessions_expires_at ON user_sessions(expires_at);

-- Trigger pour updated_at
CREATE TRIGGER update_user_sessions_updated_at 
    BEFORE UPDATE ON user_sessions 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- ================================
-- Table des logs d'audit
-- ================================
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(100),
    resource_id VARCHAR(255),
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    session_id UUID,
    status VARCHAR(20) DEFAULT 'success',
    error_message TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index pour les performances et recherches
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_resource_type ON audit_logs(resource_type);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX idx_audit_logs_status ON audit_logs(status);
CREATE INDEX idx_audit_logs_metadata ON audit_logs USING GIN(metadata);

-- ================================
-- Table des métriques système
-- ================================
CREATE TABLE system_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    metric_name VARCHAR(100) NOT NULL,
    metric_value NUMERIC NOT NULL,
    metric_unit VARCHAR(20),
    tags JSONB,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index pour les performances
CREATE INDEX idx_system_metrics_name ON system_metrics(metric_name);
CREATE INDEX idx_system_metrics_timestamp ON system_metrics(timestamp);
CREATE INDEX idx_system_metrics_tags ON system_metrics USING GIN(tags);

-- ================================
-- Table des événements application
-- ================================
CREATE TABLE application_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type VARCHAR(100) NOT NULL,
    event_name VARCHAR(100) NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    session_id UUID,
    properties JSONB,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index pour analytics
CREATE INDEX idx_application_events_type ON application_events(event_type);
CREATE INDEX idx_application_events_name ON application_events(event_name);
CREATE INDEX idx_application_events_user_id ON application_events(user_id);
CREATE INDEX idx_application_events_timestamp ON application_events(timestamp);
CREATE INDEX idx_application_events_properties ON application_events USING GIN(properties);

-- ================================
-- Table des erreurs application
-- ================================
CREATE TABLE application_errors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    error_type VARCHAR(100) NOT NULL,
    error_message TEXT NOT NULL,
    error_stack TEXT,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    session_id UUID,
    request_id VARCHAR(100),
    url VARCHAR(500),
    method VARCHAR(10),
    status_code INTEGER,
    ip_address INET,
    user_agent TEXT,
    context JSONB,
    resolved BOOLEAN DEFAULT false,
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index pour monitoring et debugging
CREATE INDEX idx_application_errors_type ON application_errors(error_type);
CREATE INDEX idx_application_errors_user_id ON application_errors(user_id);
CREATE INDEX idx_application_errors_created_at ON application_errors(created_at);
CREATE INDEX idx_application_errors_resolved ON application_errors(resolved);
CREATE INDEX idx_application_errors_status_code ON application_errors(status_code);

-- ================================
-- Table des notifications
-- ================================
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    data JSONB,
    read_at TIMESTAMP WITH TIME ZONE,
    sent_at TIMESTAMP WITH TIME ZONE,
    delivery_method VARCHAR(20) DEFAULT 'in_app',
    priority INTEGER DEFAULT 3,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index pour notifications
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_type ON notifications(type);
CREATE INDEX idx_notifications_read_at ON notifications(read_at);
CREATE INDEX idx_notifications_created_at ON notifications(created_at);

-- ================================
-- Table des configurations système
-- ================================
CREATE TABLE system_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    config_key VARCHAR(100) UNIQUE NOT NULL,
    config_value JSONB NOT NULL,
    description TEXT,
    is_sensitive BOOLEAN DEFAULT false,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index pour configuration
CREATE INDEX idx_system_config_key ON system_config(config_key);

-- Trigger pour updated_at
CREATE TRIGGER update_system_config_updated_at 
    BEFORE UPDATE ON system_config 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- ================================
-- Vue pour les statistiques utilisateurs
-- ================================
CREATE VIEW user_statistics AS
SELECT 
    COUNT(*) as total_users,
    COUNT(*) FILTER (WHERE is_active = true) as active_users,
    COUNT(*) FILTER (WHERE email_verified = true) as verified_users,
    COUNT(*) FILTER (WHERE created_at > CURRENT_DATE - INTERVAL '7 days') as new_users_week,
    COUNT(*) FILTER (WHERE created_at > CURRENT_DATE - INTERVAL '1 day') as new_users_today,
    COUNT(*) FILTER (WHERE last_login > CURRENT_DATE - INTERVAL '30 days') as active_last_month,
    AVG(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - created_at))/86400)::INTEGER as avg_user_age_days
FROM users;

-- ================================
-- Vue pour les métriques de session
-- ================================
CREATE VIEW session_metrics AS
SELECT 
    COUNT(*) as total_sessions,
    COUNT(*) FILTER (WHERE is_active = true) as active_sessions,
    AVG(EXTRACT(EPOCH FROM (COALESCE(updated_at, CURRENT_TIMESTAMP) - created_at))/60)::INTEGER as avg_session_duration_minutes,
    COUNT(DISTINCT user_id) as unique_users_with_sessions
FROM user_sessions
WHERE created_at > CURRENT_DATE - INTERVAL '1 day';

-- ================================
-- Vue pour les métriques d'erreur
-- ================================
CREATE VIEW error_metrics AS
SELECT 
    COUNT(*) as total_errors,
    COUNT(*) FILTER (WHERE created_at > CURRENT_DATE - INTERVAL '1 hour') as errors_last_hour,
    COUNT(*) FILTER (WHERE created_at > CURRENT_DATE - INTERVAL '1 day') as errors_last_day,
    COUNT(*) FILTER (WHERE resolved = false) as unresolved_errors,
    (COUNT(*) FILTER (WHERE created_at > CURRENT_DATE - INTERVAL '1 day')::FLOAT / 
     NULLIF(COUNT(*) FILTER (WHERE created_at > CURRENT_DATE - INTERVAL '2 days' AND created_at <= CURRENT_DATE - INTERVAL '1 day'), 0) * 100)::NUMERIC(5,2) as error_trend_percentage
FROM application_errors;

-- ================================
-- Fonctions utilitaires
-- ================================

-- Fonction pour nettoyer les anciennes données
CREATE OR REPLACE FUNCTION cleanup_old_data()
RETURNS void AS $$
BEGIN
    -- Supprimer les refresh tokens expirés
    DELETE FROM refresh_tokens WHERE expires_at < CURRENT_TIMESTAMP;
    
    -- Supprimer les sessions expirées
    DELETE FROM user_sessions WHERE expires_at < CURRENT_TIMESTAMP;
    
    -- Supprimer les logs d'audit anciens (>6 mois)
    DELETE FROM audit_logs WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '6 months';
    
    -- Supprimer les métriques système anciennes (>3 mois)
    DELETE FROM system_metrics WHERE timestamp < CURRENT_TIMESTAMP - INTERVAL '3 months';
    
    -- Supprimer les erreurs résolues anciennes (>1 mois)
    DELETE FROM application_errors 
    WHERE resolved = true AND resolved_at < CURRENT_TIMESTAMP - INTERVAL '1 month';
    
    -- Supprimer les notifications anciennes (>3 mois)
    DELETE FROM notifications WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '3 months';
    
    RAISE NOTICE 'Cleanup des anciennes données terminé';
END;
$$ LANGUAGE plpgsql;

-- ================================
-- Politique de sécurité RLS (Row Level Security)
-- ================================

-- Activer RLS sur les tables sensibles
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Politique pour les utilisateurs (peuvent voir/modifier leurs propres données)
CREATE POLICY user_own_data ON users
    FOR ALL
    USING (id = current_setting('app.current_user_id', true)::UUID);

CREATE POLICY session_own_data ON user_sessions
    FOR ALL
    USING (user_id = current_setting('app.current_user_id', true)::UUID);

CREATE POLICY notification_own_data ON notifications
    FOR ALL
    USING (user_id = current_setting('app.current_user_id', true)::UUID);

-- ================================
-- Rôles et permissions
-- ================================

-- Rôle pour l'application
CREATE ROLE technical_analysis_app WITH LOGIN PASSWORD 'app_password_change_in_production';

-- Permissions pour l'application
GRANT CONNECT ON DATABASE technical_analysis_db TO technical_analysis_app;
GRANT USAGE ON SCHEMA public TO technical_analysis_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO technical_analysis_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO technical_analysis_app;

-- Rôle lecture seule pour les rapports
CREATE ROLE technical_analysis_readonly WITH LOGIN PASSWORD 'readonly_password_change_in_production';
GRANT CONNECT ON DATABASE technical_analysis_db TO technical_analysis_readonly;
GRANT USAGE ON SCHEMA public TO technical_analysis_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO technical_analysis_readonly;

-- ================================
-- Insertions de configuration par défaut
-- ================================

INSERT INTO system_config (config_key, config_value, description) VALUES
('app_name', '"Technical Analysis Application"', 'Nom de l''application'),
('app_version', '"1.0.0"', 'Version de l''application'),
('maintenance_mode', 'false', 'Mode maintenance activé'),
('max_login_attempts', '5', 'Nombre maximum de tentatives de connexion'),
('session_timeout_minutes', '60', 'Durée de session en minutes'),
('password_min_length', '8', 'Longueur minimale du mot de passe'),
('email_verification_required', 'true', 'Vérification email obligatoire'),
('rate_limit_requests_per_minute', '100', 'Limite de requêtes par minute'),
('cache_ttl_seconds', '3600', 'TTL du cache en secondes'),
('log_retention_days', '90', 'Rétention des logs en jours')
ON CONFLICT (config_key) DO NOTHING;

-- ================================
-- Commentaires pour documentation
-- ================================

COMMENT ON TABLE users IS 'Table principale des utilisateurs avec informations de profil et préférences';
COMMENT ON TABLE refresh_tokens IS 'Tokens de renouvellement JWT pour l''authentification';
COMMENT ON TABLE user_sessions IS 'Sessions utilisateur actives avec informations de device et géolocalisation';
COMMENT ON TABLE audit_logs IS 'Logs d''audit pour traçabilité des actions utilisateur';
COMMENT ON TABLE system_metrics IS 'Métriques système pour monitoring et analytics';
COMMENT ON TABLE application_events IS 'Événements applicatifs pour analytics business';
COMMENT ON TABLE application_errors IS 'Erreurs applicatives pour debugging et monitoring';
COMMENT ON TABLE notifications IS 'Notifications utilisateur multi-canal';
COMMENT ON TABLE system_config IS 'Configuration système key-value avec versioning';

COMMENT ON FUNCTION cleanup_old_data() IS 'Fonction de nettoyage automatique des anciennes données';
COMMENT ON FUNCTION update_updated_at_column() IS 'Fonction trigger pour mise à jour automatique du champ updated_at';

-- ================================
-- Finalisation
-- ================================

-- Analyse des tables pour optimiser les statistiques
ANALYZE;

-- Message de fin
SELECT 'Base de données initialisée avec succès!' as message;