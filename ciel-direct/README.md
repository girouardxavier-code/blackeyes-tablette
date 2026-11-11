# Ciel Direct — application Android (APK)

Suivi du trafic aérien en direct : carte des avions colorés selon l'altitude, fiche du vol (altitude, vitesse,
cap, vario, type, immatriculation, transpondeur, photo, route), trajectoire et profil d'altitude, recherche,
liste triable, filtres, fonds de carte sombre/clair/satellite, suivi d'un vol, partage.

Recherche par numéro de vol (ex. `TO3018`, converti en indicatif radio `TVF3018`), indicatif, immatriculation
ou code hex ; si l'avion n'est pas sur la carte, il est cherché dans le monde entier (ADSB.lol).

**Partout dans le monde** : en vue large (continent, monde), les avions du monde entier sont chargés par OpenSky Network
(une requête par minute, quota gratuit limité), sinon par ADSB.lol en 30 zones autour du centre ; l'affichage passe
alors en mode rapide (canevas) pour des milliers d'avions.

**Par compagnie** : tapez son nom ou son code (« Transavia », « TO », « TVF ») ou choisissez-la dans Filtres ; seuls ses
avions sont affichés, cherchés dans le monde entier. Le bouton en bas de l'écran retire le filtre.

**Aéroports du monde entier** (6 045, source OurAirports, domaine public) : grands aéroports en vue monde, moyens en
vue continent, tous en vue région ; recherche par code, nom ou ville ; fiche en touchant l'aéroport.

**Avions, drones ou les deux** : sélecteur sous la barre de recherche.

**Détection des drones** (bouton drone) : le téléphone capte l'identification électronique diffusée par les drones en
Bluetooth (Remote ID ASTM F3411 / européen, Bluetooth 4 et 5) et en Wi-Fi (balises ASTM et signalement électronique
français, Android 11+) : identifiant, type, position, hauteur, vitesse, cap et position du pilote ou du point de
décollage, avec alerte et vibration. Les drones équipés d'ADS-B (catégorie UAV) sont aussi signalés.

Données : ADSB.lol, puis OpenSky Network en secours ; sans réseau, un trafic **fictif** simulé est affiché.

## Installer

`dist/CielDirect.apk` : copiez-le sur le téléphone, ouvrez-le et autorisez l'installation depuis cette source.
Android 7 minimum.

## Structure

- `www/` : l'application (HTML/JS, carte Leaflet), embarquée dans l'APK.
- `android/` : coquille Android (WebView). Les fichiers sont servis sous `https://appassets.androidplatform.net/` ;
  les appels aux services de données passent par un pont natif (`window.CDNative`), sans restriction CORS ;
  touche Retour, partage Android, géolocalisation.

## Reconstruire

```
apt-get install android-sdk-build-tools android-sdk-platform-23 apksigner zipalign
android/build.sh
```

La clé de signature `android/ciel-direct.keystore` n'est pas versionnée (dépôt public). Gardez-la : une mise à jour
signée avec une autre clé oblige à désinstaller l'application avant de réinstaller.
