# AetherFragm

Navigateur privé orienté performance, sécurité et sobriété visuelle.

<p align="center">
  <img src="assets/logo.png" alt="Logo AetherFragm" width="120" />
</p>

AetherFragm est un navigateur desktop construit avec Electron et Chromium, pensé pour une navigation discrète, rapide et maîtrisée. Il combine protection anti-pistage, sessions isolées, recherche interne, coffre-fort chiffré et une interface personnalisée centrée sur l’efficacité.

## Vue d’ensemble

AetherFragm ne cherche pas à reproduire un navigateur grand public classique : il s’agit d’un environnement de navigation orienté confidentialité et contrôle local.

Le projet met l’accent sur :

- blocage de traqueurs et de requêtes invasives ;
- renforcement du protocole HTTPS ;
- suppression des paramètres de tracking dans les liens ;
- isolation des sessions via des canaux éphémères ;
- stockage local sécurisé des identifiants ;
- interface de navigation minimaliste et fonctionnelle.

## Fonctionnalités

### Protection de la vie privée

- Blocage de domaines de tracking via liste locale
- Forçage du HTTPS sur les requêtes HTTP non locales
- Purge automatique des paramètres de tracking (`utm_*`, `fbclid`, `gclid`, `msclkid`, etc.)
- Isolation WebRTC et configuration DNS-over-HTTPS
- Purge de la mémoire, cookies et stockage de session
- Mode panique pour effacer les traces et verrouiller le coffre-fort

### Expérience de navigation

- Interface personnalisée avec onglets et coquille de navigateur
- Recherche interne par catégorie (web, images, vidéos, actualités)
- Mode lecture pour extraire le contenu principal d’une page
- Traduction de page simplifiée
- Gestion de signets et de téléchargements
- Barre d’état persistante et palette de commandes
- Radar des traqueurs visuellement exploitable

### Sécurité locale

- Coffre-fort chiffré avec AES-256-GCM
- Dérivation de clé via scrypt
- Stockage local des identifiants par site
- Aide au remplissage automatique de formulaires
- Protection des données sensibles au niveau du poste utilisateur

## Stack technique

- Electron
- Chromium
- JavaScript
- HTML / CSS
- Node.js pour la logique principale et le IPC
- Modules de filtrage et de recherche internes

## Structure du dépôt

```text
.
├── README.md
├── LICENSE
├── package.json
├── main.js
├── preload.js
├── preload-search.js
├── filters.js
├── search.js
├── vault.js
├── index.html
├── search.html
├── diag.html
├── read.html
├── styles.css
├── apply-correctifs.js
├── assets/
├── dist/             (généré lors des builds)
└── node_modules/     (après installation)
```

## Prérequis

- Node.js 18 ou supérieur
- npm
- Windows 10/11 (cible principale du packaging)

## Installation

```bash
git clone https://github.com/spectglak-ui/aetherfragm.git
cd aetherfragm
npm install
```

## Lancer l’application

```bash
npm start
```

## Scripts disponibles

```bash
npm start
npm run build
npm run pack
```

- `npm start` : lance l’application en mode développement
- `npm run build` : génère une build de production Windows
- `npm run pack` : prépare un paquet sans installer final

## Raccourcis clavier

- `Ctrl + T` — nouvel onglet
- `Ctrl + W` — fermer l’onglet actif
- `Ctrl + L` — focus sur la barre d’adresse
- `Ctrl + K` — ouvrir la palette de commandes
- `Ctrl + F` — recherche dans la page
- `Ctrl + Shift + X` — mode panique
- `F11` — plein écran

## Notes de conception

AetherFragm cible une navigation plus disciplinée et moins intrusive. La protection repose sur des mécanismes de blocage, d’isolation de session et de stockage sécurisé, mais le navigateur reste dépendant du moteur Chromium et des services externes auxquels il accède.

## Licence

Ce projet est publié sous licence MIT. Consultez le fichier [LICENSE](LICENSE) pour plus de détails.

## Contribution

Les contributions sont les bienvenues. Les changements doivent être clairs, documentés et, lorsque c’est pertinent, accompagnés d’une explication sur leur impact en matière de confidentialité ou de sécurité.

---

AetherFragm vise une navigation plus sûre, plus légère et plus maîtrisée — avec une attention particulière à la confidentialité, à la sobriété visuelle et au contrôle utilisateur.
