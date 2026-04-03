const express = require('express');
const cors = require('cors');
const db = require('./db');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// === DEBUG : Afficher les variables d'environnement ===
console.log('=== VÉRIFICATION DES VARIABLES ===');
console.log('DB_HOST:', process.env.DB_HOST);
console.log('DB_PORT:', process.env.DB_PORT);
console.log('DB_USER:', process.env.DB_USER);
console.log('DB_PASSWORD:', process.env.DB_PASSWORD ? '********' : 'NON DÉFINI');
console.log('DB_NAME:', process.env.DB_NAME);
console.log('PORT:', process.env.PORT);
console.log('===================================');

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.json({ message: 'API Système Incendie operationnelle' });
});

app.post('/api/donnees', async (req, res) => {
    try {
        const { temperature, gaz, flamme } = req.body;

        if (temperature === undefined || gaz === undefined) {
            return res.status(400).json({ error: 'Données incomplètes' });
        }

        const [result] = await db.execute(
            'INSERT INTO donnees (temperature, gaz, flamme) VALUES (?, ?, ?)',
            [temperature, gaz, flamme ? 1 : 0]
        );

        console.log(`Données reçues : ${temperature}°C, gaz=${gaz}, flamme=${flamme}`);
        res.status(201).json({ success: true, id: result.insertId });
    } catch (error) {
        console.error('Erreur insertion:', error);
        res.status(500).json({ error: 'Erreur serveur', details: error.message });
    }
});

app.get('/api/dernieres-donnees', async (req, res) => {
    try {
        const [rows] = await db.execute(
            'SELECT * FROM donnees ORDER BY date_heure DESC LIMIT 1'
        );
        res.json(rows[0] || {});
    } catch (error) {
        console.error('Erreur lecture:', error);
        res.status(500).json({ error: 'Erreur serveur', details: error.message });
    }
});

// Route pour les statistiques réelles
app.get('/api/statistiques', async (req, res) => {
    try {
        const [incendie] = await db.execute(
            'SELECT COUNT(*) as total FROM donnees WHERE flamme = 1'
        );
        const [gaz] = await db.execute(
            'SELECT COUNT(*) as total FROM donnees WHERE gaz >= 500'
        );
        const [temp] = await db.execute(
            'SELECT COUNT(*) as total FROM donnees WHERE temperature >= 50'
        );
        const [explosion] = await db.execute(
            'SELECT COUNT(*) as total FROM donnees WHERE gaz >= 500 AND temperature >= 50'
        );
        
        res.json({
            incendie: incendie[0].total,
            gaz: gaz[0].total,
            temp: temp[0].total,
            explosion: explosion[0].total
        });
    } catch (error) {
        console.error('Erreur stats:', error);
        res.status(500).json({ error: 'Erreur' });
    }
});

// Route pour l'historique
app.get('/api/historique', async (req, res) => {
    try {
        const [rows] = await db.execute(
            'SELECT * FROM donnees ORDER BY date_heure DESC LIMIT 100'
        );
        res.json(rows);
    } catch (error) {
        console.error('Erreur historique:', error);
        res.status(500).json({ error: 'Erreur' });
    }
});

// Route temporaire pour créer la table PostgreSQL
app.get('/api/creer-table', async (req, res) => {
    try {
        await db.query(`CREATE TABLE IF NOT EXISTS donnees (
            id SERIAL PRIMARY KEY,
            temperature FLOAT,
            gaz INT,
            flamme BOOLEAN,
            date_heure TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        res.json({ message: "Table créée avec succès" });
    } catch (error) {
        res.json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Serveur démarré sur http://localhost:${port}`);
});