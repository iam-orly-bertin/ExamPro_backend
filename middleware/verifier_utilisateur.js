
const jwt = require("jsonwebtoken");

// Verifier si l'utilisateur possede un jeton valide
function verifierUtilisateur(req, res, suivant) {
    const autorisation = req.headers.authorization;

    if (!autorisation) {
        return res.status(401).json({
            message: "Connexion requise."
        });
    }

    const jeton = autorisation.split(" ")[1];

    try {
        // Decoder le jeton pour retrouver l'utilisateur
        req.utilisateur = jwt.verify(
            jeton,
            process.env.JETON_SECRET
        );

        suivant();
    } catch (erreur) {
        return res.status(401).json({
            message: "Jeton invalide ou expire."
        });
    }
}

// Verifier si l'utilisateur est administrateur
function verifierAdmin(req, res, suivant) {
    if (req.utilisateur.role !== "admin") {
        return res.status(403).json({
            message: "Acces reserve a l'administrateur."
        });
    }

    suivant();
}

module.exports = {
    verifierUtilisateur,
    verifierAdmin
};
