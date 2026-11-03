const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const base = require("../database/connexion");
const { verifierUtilisateur } = require("../middleware/verifier_utilisateur");

const route = express.Router();

// Duree de validite du jeton (modifiable avec JETON_DUREE dans le .env : "4h", "8h"...).
// Le frontend le renouvelle automatiquement toutes les 10 minutes pendant que la page est ouverte.
const DUREE_JETON = process.env.JETON_DUREE || "4h";

function creerJeton(utilisateur) {
    return jwt.sign(
        {
            id: utilisateur.id,
            nom: utilisateur.nom,
            role: utilisateur.role
        },
        process.env.JETON_SECRET,
        { expiresIn: DUREE_JETON }
    );
}

// Limiter les tentatives (anti force brute) : 10 essais / 15 minutes par adresse IP
const limiteur = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        message: "Trop de tentatives. Reessayez dans quelques minutes."
    }
});

// INSCRIPTION d'un etudiant
route.post("/inscription", limiteur, async (req, res) => {
    try {
        const { nom, email, mot_de_passe } = req.body;

        if (!nom || !email || !mot_de_passe) {
            return res.status(400).json({
                message: "Tous les champs sont obligatoires."
            });
        }

        if (mot_de_passe.length < 8) {
            return res.status(400).json({
                message: "Le mot de passe doit contenir au moins 8 caracteres."
            });
        }

        const adresse = email.trim().toLowerCase();

        // Verifier si l'email existe deja
        const existant = base.prepare(
            "SELECT id FROM utilisateurs WHERE email = ?"
        ).get(adresse);

        if (existant) {
            return res.status(409).json({
                message: "Cette adresse email est deja utilisee."
            });
        }

        // Chiffrer le mot de passe avant de le stocker
        const motDePasseSecurise =
            await bcrypt.hash(mot_de_passe, 10);

        const resultat = base.prepare(`
            INSERT INTO utilisateurs
            (nom, email, mot_de_passe, role)
            VALUES (?, ?, ?, 'etudiant')
        `).run(nom.trim(), adresse, motDePasseSecurise);

        res.status(201).json({
            message: "Inscription reussie.",
            utilisateur: {
                id: resultat.lastInsertRowid,
                nom: nom.trim(),
                email: adresse,
                role: "etudiant"
            }
        });
    } catch (erreur) {
        console.error(erreur);
        res.status(500).json({
            message: "Erreur lors de l'inscription."
        });
    }
});

// CONNEXION d'un utilisateur
route.post("/connexion", limiteur, async (req, res) => {
    try {
        const { email, mot_de_passe } = req.body;

        if (!email || !mot_de_passe) {
            return res.status(400).json({
                message: "Email et mot de passe obligatoires."
            });
        }

        const utilisateur = base.prepare(`
            SELECT * FROM utilisateurs WHERE email = ?
        `).get(email.trim().toLowerCase());

        if (!utilisateur) {
            return res.status(401).json({
                message: "Identifiants incorrects."
            });
        }

        // Comparer le mot de passe avec sa version securisee
        const valide = await bcrypt.compare(
            mot_de_passe,
            utilisateur.mot_de_passe
        );

        if (!valide) {
            return res.status(401).json({
                message: "Identifiants incorrects."
            });
        }

        // Creer un jeton (duree : voir DUREE_JETON)
        const jeton = creerJeton(utilisateur);

        res.json({
            message: "Connexion reussie.",
            jeton,
            utilisateur: {
                id: utilisateur.id,
                nom: utilisateur.nom,
                email: utilisateur.email,
                role: utilisateur.role
            }
        });
    } catch (erreur) {
        console.error(erreur);
        res.status(500).json({
            message: "Erreur lors de la connexion."
        });
    }
});

// RENOUVELER le jeton (appele automatiquement par le frontend)
// Verifie aussi que le compte existe toujours et reprend son role actuel.
route.post("/renouveler", verifierUtilisateur, (req, res) => {
    try {
        const utilisateur = base.prepare(
            "SELECT id, nom, role FROM utilisateurs WHERE id = ?"
        ).get(req.utilisateur.id);

        if (!utilisateur) {
            return res.status(401).json({
                message: "Compte introuvable."
            });
        }

        res.json({ jeton: creerJeton(utilisateur) });
    } catch (erreur) {
        console.error(erreur);
        res.status(500).json({
            message: "Erreur lors du renouvellement de la session."
        });
    }
});

module.exports = route;