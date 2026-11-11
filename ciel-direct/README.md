# Ciel Direct — application Android (APK)

Suivi du trafic aérien en direct : carte des avions colorés selon l'altitude, fiche du vol (altitude, vitesse,
cap, vario, type, immatriculation, transpondeur, photo, route), trajectoire et profil d'altitude, recherche,
liste triable, filtres, fonds de carte sombre/clair/satellite, suivi d'un vol, partage.

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
