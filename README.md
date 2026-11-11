# Blackeyes 2 — version tablette

Application web installable (iPad, Android) : implantation du matériel BLACKEYES sur plans, photos, carte, clients,
banque de données, protocole de sûreté, devis et exports, assistant d'implantation et Simulation 3D.

- Les données restent **sur la tablette**, chiffrées (AES-256-GCM). Ce site ne contient aucune donnée.
- Échange avec le logiciel PC par dossier client `.bkdossier` protégé par mot de passe.

Programme créé par Xavier GIROUARD.

## Ciel Direct (`/radar/`)

Application de suivi du trafic aérien en direct : carte des avions colorés selon l'altitude, fiche détaillée
(altitude, vitesse, cap, vario, type, immatriculation, transpondeur, photo, route et progression), trajectoire et
profil d'altitude, recherche (vol, immatriculation, code hex, aéroport), liste triable, filtres d'altitude,
fonds de carte sombre/clair/satellite, suivi d'un vol et lien partageable (`#vol=<hex>`).

Données en direct : ADSB.lol, puis OpenSky Network en secours ; sans réseau, un trafic **fictif** simulé est affiché.
