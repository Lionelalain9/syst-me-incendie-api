// ============================================================
//   SYSTÈME DE DÉTECTION INCENDIE — SERVEUR SaaS v2.0
//   Authentification JWT + PostgreSQL + Email (Resend)
// ============================================================

const express  = require('express');
const { Pool } = require('pg');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const cors     = require('cors');
const path     = require('path');
const crypto   = require('crypto');
const { Resend } = require('resend');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3000;

// Initialisation Resend
const resend = new Resend(process.env.RESEND_API_KEY);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── PostgreSQL ───────────────────────────────────────────────
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

pool.connect()
    .then(() => console.log('✅ PostgreSQL connecté !'))
    .catch(err => console.error('❌ Erreur DB:', err.message));

// ── Middleware auth ──────────────────────────────────────────
function authMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ erreur: 'Token manquant.' });
    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch {
        res.status(403).json({ erreur: 'Token invalide.' });
    }
}

function genToken(user) {
    return jwt.sign(
        { id: user.id, email: user.email, nom: user.nom, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
    );
}

// ── Route principale ─────────────────────────────────────────
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================================
//   ROUTES DE VÉRIFICATION PAR EMAIL (RESEND)
// ============================================================

// ── Vérifier si l'email existe déjà ─────────────────────────
app.post('/api/auth/verifier-email', async (req, res) => {
    try {
        const { email } = req.body;
        const result = await pool.query('SELECT id FROM utilisateurs WHERE email=$1', [email.toLowerCase()]);
        res.json({ existe: result.rows.length > 0 });
    } catch (err) {
        console.error('Erreur vérification email:', err);
        res.status(500).json({ erreur: 'Erreur serveur' });
    }
});

// ── Envoyer un code de vérification par email (Resend) ──────
app.post('/api/auth/envoyer-code', async (req, res) => {
    try {
        const { email, code } = req.body;
        
        if (!process.env.RESEND_API_KEY) {
            return res.status(500).json({ erreur: 'Clé API Resend non configurée' });
        }
        
        const { data, error } = await resend.emails.send({
            from: 'onboarding@resend.dev',
            to: [email],
            subject: '🔐 Code de vérification SIDIRT',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; background: #0a0e1a; color: #e2e8f0; padding: 30px; border-radius: 20px;">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <span style="font-size: 3rem;">🔥</span>
                        <h2 style="color: #e65c00;">SIDIRT</h2>
                        <p style="color: #4a6080;">Système Intelligent de Détection d'Incendie</p>
                    </div>
                    <div style="background: #111827; padding: 20px; border-radius: 12px; text-align: center;">
                        <h3>Votre code de vérification</h3>
                        <div style="font-size: 2rem; letter-spacing: 5px; background: #1a2236; padding: 15px; border-radius: 10px; margin: 20px 0; font-weight: bold;">
                            ${code}
                        </div>
                        <p>Ce code expire dans 10 minutes.</p>
                        <p style="font-size: 0.8rem; color: #4a6080;">Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>
                    </div>
                </div>
            `
        });
        
        if (error) {
            console.error('Erreur Resend:', error);
            return res.status(500).json({ erreur: "Erreur d'envoi d'email" });
        }
        
        res.json({ message: 'Code envoyé avec succès' });
    } catch (err) {
        console.error('Erreur envoi email:', err);
        res.status(500).json({ erreur: 'Erreur serveur' });
    }
});

// ============================================================
//   ROUTES PRINCIPALES
// ============================================================

// ── Inscription ──────────────────────────────────────────────
app.post('/api/auth/inscription', async (req, res) => {
    try {
        const { nom, email, mot_de_passe } = req.body;
        if (!nom || !email || !mot_de_passe)
            return res.status(400).json({ erreur: 'Tous les champs sont requis.' });
        if (mot_de_passe.length < 8)
            return res.status(400).json({ erreur: 'Mot de passe trop court (min. 8 caractères).' });

        const exist = await pool.query('SELECT id FROM utilisateurs WHERE email=$1', [email.toLowerCase()]);
        if (exist.rows.length > 0)
            return res.status(409).json({ erreur: 'Cet email est déjà utilisé.' });

        const hash = await bcrypt.hash(mot_de_passe, 10);
        const result = await pool.query(
            'INSERT INTO utilisateurs (nom, email, mot_de_passe) VALUES ($1, $2, $3) RETURNING id, nom, email, role',
            [nom.trim(), email.toLowerCase().trim(), hash]
        );
        const user = result.rows[0];

        const tokenAppareil = crypto.randomBytes(32).toString('hex');
        await pool.query(
            'INSERT INTO appareils (utilisateur_id, nom, lieu, token_appareil) VALUES ($1, $2, $3, $4)',
            [user.id, 'Mon ESP32 Principal', 'Maison', tokenAppareil]
        );

        const token = genToken(user);
        console.log(`✅ Inscription : ${nom} (${email})`);
        res.status(201).json({
            message: 'Compte créé avec succès !',
            token, user,
            token_appareil: tokenAppareil
        });
    } catch (err) {
        console.error('Erreur inscription:', err);
        res.status(500).json({ erreur: 'Erreur serveur lors de l\'inscription.' });
    }
});

// ── Connexion ────────────────────────────────────────────────
app.post('/api/auth/connexion', async (req, res) => {
    try {
        const { email, mot_de_passe } = req.body;
        if (!email || !mot_de_passe)
            return res.status(400).json({ erreur: 'Email et mot de passe requis.' });

        const result = await pool.query(
            'SELECT * FROM utilisateurs WHERE email=$1 AND actif=TRUE',
            [email.toLowerCase().trim()]
        );
        if (!result.rows.length)
            return res.status(401).json({ erreur: 'Email ou mot de passe incorrect.' });

        const user = result.rows[0];
        const valide = await bcrypt.compare(mot_de_passe, user.mot_de_passe);
        if (!valide)
            return res.status(401).json({ erreur: 'Email ou mot de passe incorrect.' });

        const token = genToken(user);
        console.log(`🔐 Connexion : ${user.nom}`);
        res.json({ message: 'Connexion réussie !', token, user: { id: user.id, nom: user.nom, email: user.email, role: user.role } });
    } catch (err) {
        console.error('Erreur connexion:', err);
        res.status(500).json({ erreur: 'Erreur serveur lors de la connexion.' });
    }
});

// ── Données ESP32 ────────────────────────────────────────────
app.post('/api/capteur/donnees', async (req, res) => {
    try {
        const tokenAppareil = req.headers['x-device-token'];
        if (!tokenAppareil) return res.status(401).json({ erreur: 'Token appareil manquant.' });

        const result = await pool.query(
            'SELECT * FROM appareils WHERE token_appareil=$1 AND actif=TRUE', [tokenAppareil]
        );
        if (!result.rows.length) return res.status(403).json({ erreur: 'Appareil non reconnu.' });

        const appareil = result.rows[0];
        const { temperature, gaz, flamme } = req.body;

        await pool.query(
            'INSERT INTO donnees (appareil_id, utilisateur_id, temperature, gaz, flamme) VALUES ($1,$2,$3,$4,$5)',
            [appareil.id, appareil.utilisateur_id, parseFloat(temperature), parseInt(gaz), flamme ? true : false]
        );
        console.log(`📥 [${appareil.nom}] T:${temperature}°C G:${gaz} F:${flamme}`);
        res.status(201).json({ message: 'Données enregistrées.' });
    } catch (err) {
        console.error('Erreur capteur:', err);
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

// ── Mes appareils ────────────────────────────────────────────
app.get('/api/appareils', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, nom, lieu, token_appareil, actif, date_creation FROM appareils WHERE utilisateur_id=$1',
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) { res.status(500).json({ erreur: 'Erreur serveur.' }); }
});

// ── Dernière donnée ──────────────────────────────────────────
app.get('/api/dernieres-donnees', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT d.*, a.nom as appareil_nom, a.lieu
             FROM donnees d JOIN appareils a ON d.appareil_id=a.id
             WHERE d.utilisateur_id=$1
             ORDER BY d.date_heure DESC LIMIT 1`,
            [req.user.id]
        );
        if (!result.rows.length) return res.json({});
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ erreur: 'Erreur serveur.' }); }
});

// ── Historique ───────────────────────────────────────────────
app.get('/api/historique', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT d.*, a.nom as appareil_nom, a.lieu
             FROM donnees d JOIN appareils a ON d.appareil_id=a.id
             WHERE d.utilisateur_id=$1
             ORDER BY d.date_heure DESC LIMIT 100`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) { res.status(500).json({ erreur: 'Erreur serveur.' }); }
});

// ── Statistiques ─────────────────────────────────────────────
app.get('/api/statistiques', authMiddleware, async (req, res) => {
    try {
        const uid = req.user.id;
        const inc  = await pool.query('SELECT COUNT(*) FROM donnees WHERE utilisateur_id=$1 AND flamme=TRUE', [uid]);
        const gaz  = await pool.query('SELECT COUNT(*) FROM donnees WHERE utilisateur_id=$1 AND gaz>=500', [uid]);
        const temp = await pool.query('SELECT COUNT(*) FROM donnees WHERE utilisateur_id=$1 AND temperature>=50', [uid]);
        const expl = await pool.query('SELECT COUNT(*) FROM donnees WHERE utilisateur_id=$1 AND gaz>=500 AND temperature>=50', [uid]);
        res.json({
            incendie: parseInt(inc.rows[0].count),
            gaz: parseInt(gaz.rows[0].count),
            temp: parseInt(temp.rows[0].count),
            explosion: parseInt(expl.rows[0].count)
        });
    } catch (err) { res.status(500).json({ erreur: 'Erreur serveur.' }); }
});

app.listen(PORT, () => {
    console.log(`🚀 Serveur SDI démarré sur http://localhost:${PORT}`);
    console.log(`🔐 JWT activé`);
    console.log(`📡 En attente des connexions...`);
});
