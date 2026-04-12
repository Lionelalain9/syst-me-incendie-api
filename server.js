// ============================================================
//   SYSTÈME DE DÉTECTION INCENDIE — SERVEUR SaaS v2.0
//   Authentification JWT + Multi-utilisateurs
// ============================================================

const express  = require('express');
const mysql    = require('mysql2/promise');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const cors     = require('cors');
const path     = require('path');
const crypto   = require('crypto');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middlewares ──────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Connexion base de données ────────────────────────────────
const pool = mysql.createPool({
    host    : process.env.DB_HOST,
    port    : parseInt(process.env.DB_PORT) || 5432,
    user    : process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl     : { rejectUnauthorized: false },
    waitForConnections: true,
    connectionLimit: 10
});

// ── Middleware auth ──────────────────────────────────────────
const auth = require('./middleware/auth');

// ── Générer un token JWT ─────────────────────────────────────
function genToken(user) {
    return jwt.sign(
        { id: user.id, email: user.email, nom: user.nom, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
    );
}

// ============================================================
//   ROUTES PUBLIQUES (sans auth)
// ============================================================

// ── Page principale → login ──────────────────────────────────
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── POST /api/auth/inscription ───────────────────────────────
app.post('/api/auth/inscription', async (req, res) => {
    try {
        const { nom, email, mot_de_passe } = req.body;

        if (!nom || !email || !mot_de_passe)
            return res.status(400).json({ erreur: 'Tous les champs sont requis.' });

        if (mot_de_passe.length < 8)
            return res.status(400).json({ erreur: 'Le mot de passe doit contenir au moins 8 caractères.' });

        const [existants] = await pool.execute(
            'SELECT id FROM utilisateurs WHERE email = ?', [email]
        );
        if (existants.length > 0)
            return res.status(409).json({ erreur: 'Cet email est déjà utilisé.' });

        const hash = await bcrypt.hash(mot_de_passe, 10);

        const [result] = await pool.execute(
            'INSERT INTO utilisateurs (nom, email, mot_de_passe) VALUES (?, ?, ?)',
            [nom.trim(), email.toLowerCase().trim(), hash]
        );

        const tokenAppareil = crypto.randomBytes(32).toString('hex');
        await pool.execute(
            'INSERT INTO appareils (utilisateur_id, nom, lieu, token_appareil) VALUES (?, ?, ?, ?)',
            [result.insertId, 'Mon ESP32 Principal', 'Maison', tokenAppareil]
        );

        const user = { id: result.insertId, nom: nom.trim(), email, role: 'client' };
        const token = genToken(user);

        console.log(`✅ Nouvel utilisateur : ${nom} (${email})`);
        res.status(201).json({
            message: 'Compte créé avec succès !',
            token,
            user: { id: user.id, nom: user.nom, email: user.email, role: user.role },
            token_appareil: tokenAppareil
        });

    } catch (err) {
        console.error('Erreur inscription:', err);
        res.status(500).json({ erreur: 'Erreur serveur lors de l\'inscription.' });
    }
});

// ── POST /api/auth/connexion ─────────────────────────────────
app.post('/api/auth/connexion', async (req, res) => {
    try {
        const { email, mot_de_passe } = req.body;

        if (!email || !mot_de_passe)
            return res.status(400).json({ erreur: 'Email et mot de passe requis.' });

        const [users] = await pool.execute(
            'SELECT * FROM utilisateurs WHERE email = ? AND actif = TRUE',
            [email.toLowerCase().trim()]
        );

        if (users.length === 0)
            return res.status(401).json({ erreur: 'Email ou mot de passe incorrect.' });

        const user = users[0];
        const mdpValide = await bcrypt.compare(mot_de_passe, user.mot_de_passe);

        if (!mdpValide)
            return res.status(401).json({ erreur: 'Email ou mot de passe incorrect.' });

        const token = genToken(user);
        console.log(`🔐 Connexion : ${user.nom} (${user.email})`);

        res.json({
            message: 'Connexion réussie !',
            token,
            user: { id: user.id, nom: user.nom, email: user.email, role: user.role }
        });

    } catch (err) {
        console.error('Erreur connexion:', err);
        res.status(500).json({ erreur: 'Erreur serveur lors de la connexion.' });
    }
});

// ── POST /api/capteur/donnees ── Envoi depuis ESP32 ──────────
app.post('/api/capteur/donnees', async (req, res) => {
    try {
        const tokenAppareil = req.headers['x-device-token'];
        if (!tokenAppareil)
            return res.status(401).json({ erreur: 'Token appareil manquant.' });

        const [appareils] = await pool.execute(
            'SELECT * FROM appareils WHERE token_appareil = ? AND actif = TRUE',
            [tokenAppareil]
        );
        if (appareils.length === 0)
            return res.status(403).json({ erreur: 'Appareil non reconnu.' });

        const appareil = appareils[0];
        const { temperature, gaz, flamme } = req.body;

        await pool.execute(
            'INSERT INTO donnees (appareil_id, utilisateur_id, temperature, gaz, flamme) VALUES (?, ?, ?, ?, ?)',
            [appareil.id, appareil.utilisateur_id, parseFloat(temperature), parseInt(gaz), flamme ? 1 : 0]
        );

        console.log(`📥 [${appareil.nom}] Temp:${temperature}°C Gaz:${gaz} Flamme:${flamme}`);
        res.status(201).json({ message: 'Données enregistrées.' });

    } catch (err) {
        console.error('Erreur capteur:', err);
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

// ============================================================
//   ROUTES PRIVÉES (auth requise)
// ============================================================

app.get('/api/moi', auth, async (req, res) => {
    try {
        const [users] = await pool.execute(
            'SELECT id, nom, email, role, date_creation FROM utilisateurs WHERE id = ?',
            [req.user.id]
        );
        if (!users.length) return res.status(404).json({ erreur: 'Utilisateur introuvable.' });
        res.json(users[0]);
    } catch (err) {
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

app.get('/api/appareils', auth, async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT id, nom, lieu, token_appareil, actif, date_creation FROM appareils WHERE utilisateur_id = ?',
            [req.user.id]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

app.get('/api/donnees/derniere', auth, async (req, res) => {
    try {
        const [rows] = await pool.execute(
            `SELECT d.*, a.nom as appareil_nom, a.lieu
             FROM donnees d JOIN appareils a ON d.appareil_id = a.id
             WHERE d.utilisateur_id = ?
             ORDER BY d.date_heure DESC LIMIT 1`,
            [req.user.id]
        );
        if (!rows.length) return res.status(404).json({ message: 'Aucune donnée.' });
        res.json({ ...rows[0], flamme: rows[0].flamme === 1 });
    } catch (err) {
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

app.get('/api/historique', auth, async (req, res) => {
    try {
        const [rows] = await pool.execute(
            `SELECT d.*, a.nom as appareil_nom, a.lieu
             FROM donnees d JOIN appareils a ON d.appareil_id = a.id
             WHERE d.utilisateur_id = ?
             ORDER BY d.date_heure DESC LIMIT 100`,
            [req.user.id]
        );
        res.json(rows.map(r => ({ ...r, flamme: r.flamme === 1 })));
    } catch (err) {
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

app.get('/api/statistiques', auth, async (req, res) => {
    try {
        const uid = req.user.id;
        const [[inc]]  = await pool.execute('SELECT COUNT(*) as total FROM donnees WHERE utilisateur_id=? AND flamme=1', [uid]);
        const [[gaz]]  = await pool.execute('SELECT COUNT(*) as total FROM donnees WHERE utilisateur_id=? AND gaz>=500', [uid]);
        const [[temp]] = await pool.execute('SELECT COUNT(*) as total FROM donnees WHERE utilisateur_id=? AND temperature>=50', [uid]);
        const [[expl]] = await pool.execute('SELECT COUNT(*) as total FROM donnees WHERE utilisateur_id=? AND gaz>=500 AND temperature>=50', [uid]);
        res.json({ incendie: inc.total, gaz: gaz.total, temp: temp.total, explosion: expl.total });
    } catch (err) {
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

app.get('/api/dernieres-donnees', auth, async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT * FROM donnees WHERE utilisateur_id=? ORDER BY date_heure DESC LIMIT 1',
            [req.user.id]
        );
        if (!rows.length) return res.json({});
        res.json({ ...rows[0], flamme: rows[0].flamme === 1 });
    } catch (err) {
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

app.put('/api/appareils/:id', auth, async (req, res) => {
    try {
        const { nom, lieu } = req.body;
        await pool.execute(
            'UPDATE appareils SET nom=?, lieu=? WHERE id=? AND utilisateur_id=?',
            [nom, lieu, req.params.id, req.user.id]
        );
        res.json({ message: 'Appareil mis à jour.' });
    } catch (err) {
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

app.get('/api/admin/utilisateurs', auth, async (req, res) => {
    if (req.user.role !== 'admin')
        return res.status(403).json({ erreur: 'Accès administrateur requis.' });
    try {
        const [rows] = await pool.execute(
            'SELECT id, nom, email, role, actif, date_creation FROM utilisateurs ORDER BY date_creation DESC'
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Serveur SDI SaaS démarré sur http://localhost:${PORT}`);
    console.log(`🔐 Authentification JWT activée`);
    console.log(`📡 En attente des connexions...`);
});