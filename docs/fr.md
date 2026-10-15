# Passerelle eedomus

Cette intégration relie Gladys à **votre box eedomus** et propose chaque
périphérique eedomus dans l'onglet **Découverte** de Gladys : lampes, prises,
volets, radiateurs fil pilote, consignes, capteurs, compteurs, télécommandes.
Une fois un appareil ajouté, ses valeurs suivent la box toutes les quelques
secondes, et Gladys le pilote **à travers la box**, qui continue de tourner
avec ses modules Z-Wave, Zigbee, RF et ses plugins. Passez à Gladys à votre
rythme, pièce par pièce, ou utilisez les deux côte à côte. Non officiel, sans
lien avec Connected Object (le fabricant d'eedomus).

> **Version de développement (0.1).** Construite à partir de la documentation
> de l'API eedomus et testée sur une box simulée, **pas encore sur une vraie
> eedomus**. Vos retours sont les bienvenus sur le dépôt GitHub : ce sont eux
> qui feront la prochaine version.

## Ce que vous obtenez

| Périphériques eedomus (usage)                                                | Dans Gladys                                                   |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Lampe (tout ou rien, ou variateur)                                           | une lumière : allumage, luminosité                            |
| Appareil électrique, relais de chauffage                                     | un interrupteur (et son niveau s'il en a)                     |
| Chauffage fil pilote (Arrêt, Hors gel, Eco, Confort -2, Confort -1, Confort) | un radiateur fil pilote, chaque ordre                         |
| Consigne de température, thermostat dont les valeurs sont des températures   | une consigne de thermostat                                    |
| Volet, volets, centralisation des ouvrants                                   | un volet : ouvrir, fermer, stop (si la box en a un), position |
| Armement alarme, autre actionneur, mode de thermostat                        | une liste de ses valeurs                                      |
| Interrupteur/Télécommande                                                    | un bouton : chaque appui est un événement pour vos scènes     |
| Détecteurs de mouvement, de présence, d'ouverture, de fumée, d'inondation    | capteurs de mouvement, d'ouverture, de fumée et de fuite      |
| Température, humidité, luminosité, pression, CO₂, bruit, pluie, vent, UV     | le capteur de la bonne catégorie                              |
| Puissance, énergie (Linky, prises), tension, courant, compteurs d'eau et gaz | puissance, index d'énergie, tension, courant, volume          |
| Autres indicateurs (phase de la journée, messages…)                          | un texte, ou une valeur avec son unité                        |
| Niveau de batterie des modules sur pile                                      | le niveau de batterie                                         |

Chaque périphérique eedomus donne **un appareil Gladys**, nommé d'après le
périphérique et sa pièce (« Lampe (Salon) ») ; son identifiant, son usage et
son module parent sont gardés dans ses paramètres. Un module à plusieurs
canaux (un détecteur de mouvement avec sa température et sa luminosité) donne
un appareil par canal, pour que chaque canal garde sa pièce.

L'intégration lit d'abord l'**unité** de chaque valeur : un périphérique resté
avec l'usage « Température » mais qui mesure des watts est proposé comme un
compteur de puissance.

## Prérequis

- Une box eedomus (eedomus+ ou eedomus) et ses **identifiants d'API**.
- Pour la connexion locale : la machine Gladys joint la box sur le réseau
  local (port 80). Sinon, le cloud eedomus est utilisé (accès à internet).

## Installation

1. Récupérez vos **identifiants d'API** : sur [secure.eedomus.com](https://secure.eedomus.com),
   **Configuration → Mon compte → Identifiants API**. eedomus envoie
   l'utilisateur et le secret d'API par e-mail. Ce ne sont pas ceux de votre
   compte eedomus.
2. Trouvez l'**adresse IP de la box** sur votre réseau (votre box internet
   liste les appareils de votre réseau), comme `192.168.1.30`.
3. Dans Gladys, ouvrez l'intégration, **Configuration** :
   - **Adresse IP de la box eedomus** : `192.168.1.30`. Laissez vide pour
     passer uniquement par le cloud eedomus.
   - **Utilisateur d'API** et **Secret d'API** : collez-les.
4. Cliquez sur **Tester la connexion** : l'API locale et le cloud eedomus sont
   essayés l'un après l'autre, puis le nombre de périphériques, de pièces et
   d'appareils proposés s'affiche.
5. Ouvrez l'onglet **Découverte** et ajoutez les appareils voulus. Leurs
   valeurs sont envoyées dès qu'ils sont ajoutés.

## Options

- **Préférer la connexion locale** (un interrupteur de Gladys) : activé par
  défaut. L'intégration parle à la box sur votre réseau, et ne passe par le
  cloud eedomus que si la box ne répond pas (la box est alors retentée toutes
  les 5 minutes). Désactivez-le pour passer d'abord par le cloud, la box
  servant de secours.
- **Intervalle entre deux lectures des valeurs** : 15 secondes par défaut (5 à
  300). Les valeurs de tous les appareils ajoutés sont lues en une seule
  requête à la box. Via le cloud eedomus, au plus une fois par minute, pour
  rester dans les quotas du cloud.

## Bon à savoir

- **La box reste maître des modules** : Gladys envoie ses commandes à la box,
  qui pilote les modules Z-Wave, Zigbee, RF. Gardez-la allumée, avec ses
  règles si vous le souhaitez.
- **La box est lente** : l'intégration envoie une requête à la fois, jamais à
  moins de 0,6 s d'intervalle. Une commande apparaît dans Gladys en moins de
  2 secondes.
- **Des valeurs, pas des événements** : les valeurs sont lues à l'intervalle
  choisi, un mouvement plus court que l'intervalle peut donc être manqué.
  Baissez l'intervalle pour vos détecteurs de mouvement, pas sous 5 secondes.
- **Télécommandes et interrupteurs muraux** : chaque nouvelle valeur est un
  appui pour vos scènes (« Simple appui » un clic, « Double appui » un double
  clic, « Appui long » un appui long…), même le même bouton deux fois de suite,
  tant que les appuis sont séparés d'une lecture.
- **Listes de valeurs** : une commande envoie toujours une des valeurs
  qu'eedomus autorise pour le périphérique : un variateur dont la liste va de
  10 % en 10 % va au palier le plus proche, une consigne à la température la
  plus proche de sa liste.
- **Un périphérique nouveau ou renommé** apparaît en moins de 15 minutes, tout
  de suite avec le bouton **Scanner** de l'onglet Découverte.
- **Badge de transport** : « local » via la box, « cloud » via eedomus, avec un
  point orange sur la voie de secours ; « injoignable » quand rien ne répond,
  ou quand la box a elle-même perdu le module (« Non joignable » dans eedomus).
- **Détecteurs d'ouverture** : eedomus dit Fermé / Ouvert, Gladys 1 pour fermé
  et 0 pour ouvert ; l'intégration convertit.

## Dépannage

| Message d'état                           | Que faire                                                                                                      |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| eedomus a refusé les identifiants d'API  | Vérifiez l'utilisateur et le secret d'API (Configuration → Mon compte → Identifiants API), pas ceux du compte. |
| La box eedomus (…) est injoignable       | Vérifiez son adresse IP, vue depuis la machine Gladys (pas localhost). La box est-elle allumée ?               |
| Connecté via le cloud eedomus : la box … | La box ne répond pas sur le réseau : vérifiez son adresse ; le cloud prend le relais en attendant.             |
| Le cloud eedomus est injoignable         | Vérifiez l'accès à internet de la machine Gladys, ou renseignez l'adresse de la box.                           |
| eedomus a répondu par une erreur         | Le message de la box dit pourquoi (un périphérique inconnu, une valeur qu'il n'accepte pas…).                  |

Les logs de l'intégration (Gladys, page de l'intégration) donnent le détail.
Ils ne contiennent jamais le secret d'API.

## Vie privée

Avec la connexion locale, tout reste sur votre réseau : l'intégration ne parle
qu'à votre box. Le cloud eedomus (api.eedomus.com) ne sert que si la box ne
répond pas, ou si vous l'avez choisi. Le secret d'API est stocké comme un
secret par Gladys et jamais écrit dans les logs.
