# ExamPro — Backend (API)

Express 5 + SQLite. Déployé sur Render.

## En local
```bash
cp .env.example .env     # puis éditez JETON_SECRET (32 caractères minimum)
npm install
npm run creer-admin      # crée un administrateur (ou utilisez ADMIN_EMAIL / ADMIN_MOT_DE_PASSE)
npm start
```

## Sur Render
- Build Command : `npm install`
- Start Command : `npm start`
- Variables d'environnement : `JETON_SECRET`, `FRONTEND_URL`, `ADMIN_EMAIL`, `ADMIN_MOT_DE_PASSE`, (`ADMIN_NOM`)
- Avec un disque persistant (offre payante) : monter le disque sur `/var/data` et définir `DB_PATH=/var/data/exampro.db`
