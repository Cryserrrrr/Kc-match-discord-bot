# Système de Notifications de Score

Ce document explique le nouveau système de notifications de score ajouté au bot Discord Karmine Corp.

## Fonctionnalités

### 1. Suivi des Statuts de Match

- **scheduled** : Match programmé
- **live** : Match en cours
- **finished** : Match terminé avec score disponible
- **announced** : Match terminé et score annoncé

### 2. Notifications de Score

- Envoi automatique d'une notification à la fin de chaque match
- Affichage du score final avec indication de victoire/défaite/match nul
- Respect des filtres d'équipes configurés par serveur
- Option pour désactiver les notifications de score par serveur

## Configuration

### Activation/Désactivation des Notifications de Score

1. Utilisez la commande `/config`
2. Sélectionnez "🏆 Notifications de score"
3. Cliquez sur "✅ Activer" ou "❌ Désactiver"

### Filtrage par Équipe

Les notifications de score respectent le même filtre d'équipes que les autres notifications :

- Si aucun filtre n'est configuré : toutes les équipes KC
- Si un filtre est configuré : seulement les équipes sélectionnées

## Scripts

### 1. `get-matches.ts` (Mis à jour)

- Récupère les nouveaux matchs programmés
- Vérifie les matchs en cours et met à jour leurs statuts
- Récupère les scores des matchs terminés

### 2. `check-upcoming-matches.ts` (Mis à jour)

- Vérifie les matchs programmés dans les 30-35 prochaines minutes
- Envoie les notifications d'avant-match
- **NOUVEAU** : Vérifie les matchs terminés et envoie les notifications de score

### 3. `check-scores.ts` (Nouveau)

- Script dédié pour tester la vérification des scores
- Peut être exécuté manuellement pour vérifier les matchs en cours et terminés

## Base de Données

### Nouveaux Champs dans la Table `Match`

```sql
status          String   @default("scheduled") // scheduled, live, finished, announced
score           String?  // Score du match (ex: "2-1", "3-0")
```

### Nouveau Champ dans la Table `GuildSettings`

```sql
enableScoreNotifications Boolean @default(true) // Activer/désactiver les notifications de score
```

## Migration

Pour appliquer les changements de base de données :

```bash
npx prisma migrate dev --name add_status_score_and_score_notifications
```

## Utilisation

### Déploiement Automatique

Les notifications de score sont automatiquement envoyées quand :

1. Le script `check-upcoming-matches.ts` s'exécute (généralement toutes les 5 minutes)
2. Un match est détecté comme terminé avec un score disponible
3. Le serveur a activé les notifications de score

### Test Manuel

Pour tester manuellement le système :

```bash
# Vérifier les scores des matchs
npm run check-scores

# Vérifier les matchs à venir et envoyer les notifications
npm run check-upcoming-matches
```

## Format des Notifications

### Embed de Score

- **Titre** : Emoji de résultat + Équipes + Emoji de résultat
- **Description** : Ligue, Série, Tournoi
- **Champs** :
  - Résultat (Victoire/Défaite/Match nul) + Score
  - Date du match
  - Heure du match
  - Format (Bo3, Bo5, etc.)
- **Couleur** : Dépend de l'équipe KC (LOL: bleu, Valorant: rouge, RL: orange)

### Exemples de Messages

- `🏆 **Match terminé !** 🏆` + Embed avec score
- Victoire : `✅ Victoire KC ! (2-1)`
- Défaite : `❌ Défaite KC (1-2)`
- Match nul : `🤝 Match nul (1-1)`

## Gestion des Erreurs

### Retry Logic

- Toutes les requêtes API utilisent un système de retry avec backoff exponentiel
- Maximum 3-5 tentatives selon le script
- Timeout de 60 secondes pour les requêtes PandaScore

### Logs

- Logs détaillés pour le debugging
- Différents niveaux : info, warn, error
- Identification claire des matchs et serveurs

## Limitations

### API PandaScore

- Les scores ne sont disponibles que pour les matchs terminés
- Certains matchs peuvent ne pas avoir de score immédiatement
- Rate limiting de l'API PandaScore

### Base de Données

- Les nouveaux champs ne sont disponibles qu'après application de la migration
- Les scripts sont compatibles avec l'ancienne structure (commentaires temporaires)

## Prochaines Étapes

1. Appliquer la migration de base de données
2. Décommenter les lignes de code temporairement commentées
3. Tester le système avec des matchs réels
4. Ajuster les intervalles de vérification si nécessaire
5. Ajouter des métriques de performance
