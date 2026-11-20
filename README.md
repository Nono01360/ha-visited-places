# Visited Places — Home Assistant

Intégration personnalisée et carte Lovelace interactive pour épingler des lieux précis (villes, monuments, restaurants, randonnées, adresses exactes) et les marquer comme **Visités** ou **À visiter** directement depuis l'interface graphique de Home Assistant.

## Fonctionnalités
- **100 % configurable via l'interface graphique** (assistant d'installation + menu *Configurer* pour modifier les coordonnées par défaut, le zoom et les profils/personnes).
- **Centrage automatique** sur les coordonnées de votre maison Home Assistant.
- **Ajout par clic direct sur la carte** ou par **recherche d'adresse / nom de lieu** (géocodage automatique via OpenStreetMap Nominatim).
- **Carte Lovelace interactive embarquée** (`Visited Places Map`) avec éditeur visuel intégré, filtrage par statut (*Tous*, *Visités*, *À visiter*), filtrage par personne et choix du style de carte (*CARTO Voyager*, *Dark Matter*, *Satellite Esri*).
- **Persistance native** dans le stockage interne `.storage` de Home Assistant.

## Installation via HACS (Dépôt personnalisé)
1. Ouvrez **HACS** dans Home Assistant.
2. Cliquez sur le menu à trois points en haut à droite > **Dépôts personnalisés**.
3. Ajoutez l'URL de ce dépôt GitHub avec la catégorie **Intégration**.
4. Téléchargez **Visited Places** et redémarrez Home Assistant.
5. Allez dans **Paramètres > Appareils et services > + Ajouter une intégration** et sélectionnez **Visited Places**.
6. Ajoutez la carte **Visited Places Map** sur votre tableau de bord via l'interface visuelle.
