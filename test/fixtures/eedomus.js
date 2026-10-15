// -----------------------------------------------------------------------------
// The answers of a fictional eedomus box, shaped like the ones of the API
// documentation (doc.eedomus.com, "API eedomus") and of real boxes: the
// `body` of periph.list, periph.value_list (periph_id=all) and
// periph.caract (periph_id=all). Every value is a string, as the box sends
// it; the `unit` and `icon` of periph.list are not in the documentation but
// in every real answer. Made up for the tests: no real box was dumped.
// -----------------------------------------------------------------------------

const ROOMS = {
  salon: ['20101', 'Salon'],
  cuisine: ['20102', 'Cuisine'],
  chambre: ['20103', 'Chambre'],
  bureau: ['20104', 'Bureau'],
  entree: ['20105', 'Entrée'],
  couloir: ['20106', 'Couloir'],
  buanderie: ['20107', 'Buanderie'],
  sdb: ['20108', 'Salle de bain'],
  garage: ['20109', 'Garage'],
  jardin: ['20110', 'Jardin'],
  hidden: ['1', '[Invisible]'],
};

/** periph.value_list entries: [value, description] pairs. */
const ON_OFF = [
  ['0', 'Off'],
  ['100', 'On'],
];
const MAINS = [
  ['-2', 'Secteur coupé'],
  ['-3', 'Secteur rétabli'],
];
const LEVELS = [10, 20, 30, 40, 50, 60, 70, 80, 90].map((n) => [String(n), `${n} %`]);

/**
 * [periph_id, name, room, usage_id, usage_name, value_type, unit, values,
 *  caract: [last_value, last_value_text, battery], parent, battery in the list]
 */
const PERIPHERALS = [
  [
    '1061001',
    'Lampe salon',
    'salon',
    '1',
    'Lampe',
    'list',
    '',
    [...MAINS, ...ON_OFF],
    ['0', 'Off'],
  ],
  [
    '1061002',
    'Variateur cuisine',
    'cuisine',
    '1',
    'Lampe',
    'list',
    '',
    [['0', 'Off'], ...LEVELS, ['100', 'On']],
    ['30', '30 %'],
  ],
  ['1061003', 'Prise TV', 'salon', '2', 'Appareil électrique', 'list', '', ON_OFF, ['100', 'On']],
  [
    '1061004',
    'Prise TV consommation',
    'salon',
    '26',
    'Consomètre',
    'float',
    'W',
    [],
    ['82.4', ''],
    '1061003',
  ],
  [
    '1061005',
    'Volet salon',
    'salon',
    '48',
    'Volet',
    'list',
    '',
    [['0', 'Fermé'], ...LEVELS, ['100', 'Ouvert']],
    ['100', 'Ouvert'],
  ],
  [
    '1061006',
    'Volet chambre',
    'chambre',
    '48',
    'Volet',
    'list',
    '',
    [
      ['0', 'Fermé'],
      ['100', 'Ouvert'],
      ['MY', 'Stop'],
    ],
    ['0', 'Fermé'],
  ],
  [
    '1061007',
    'Radiateur chambre',
    'chambre',
    '4',
    'Chauffage',
    'list',
    '',
    [
      ['0', 'Arrêt'],
      ['15', 'Hors Gel'],
      ['25', 'Eco'],
      ['35', 'Confort -2'],
      ['45', 'Confort -1'],
      ['100', 'Confort'],
    ],
    ['25', 'Eco'],
  ],
  [
    '1061008',
    'Consigne salon',
    'salon',
    '15',
    'Consigne de température',
    'float',
    '°C',
    [],
    ['19.5', ''],
  ],
  [
    '1061009',
    'Thermostat bureau',
    'bureau',
    '0',
    'Thermostat',
    'list',
    '',
    ['16', '17', '18', '19', '19.5', '20', '20.5', '21', '22'].map((t) => [t, `${t}°C`]),
    ['19', '19°C'],
  ],
  [
    '1061010',
    'Détecteur entrée',
    'entree',
    '37',
    'Mouvement',
    'list',
    '',
    [
      ['0', 'Aucun mouvement'],
      ['100', 'Mouvement'],
      ['50', 'Vibration'],
    ],
    ['0', 'Aucun mouvement', '85'],
    undefined,
    '85',
  ],
  [
    '1061011',
    'Détecteur entrée température',
    'entree',
    '7',
    'Température',
    'float',
    '°C',
    [],
    ['20.8', '', '85'],
    '1061010',
    '85',
  ],
  [
    '1061012',
    'Détecteur entrée luminosité',
    'entree',
    '24',
    'Luminosité',
    'float',
    'Lux',
    [],
    ['112', '', '85'],
    '1061010',
    '85',
  ],
  [
    '1061013',
    "Porte d'entrée",
    'entree',
    '10',
    "Détecteur d'ouverture",
    'list',
    '',
    [
      ['0', 'Fermé'],
      ['100', 'Ouvert'],
    ],
    ['0', 'Fermé', '90'],
    undefined,
    '90',
  ],
  [
    '1061014',
    'Détecteur fumée',
    'couloir',
    '27',
    'Fumée',
    'list',
    '',
    [
      ['0', 'OK'],
      ['100', 'Alarme'],
    ],
    ['0', 'OK', '100'],
    undefined,
    '100',
  ],
  [
    '1061015',
    'Détecteur inondation',
    'buanderie',
    '36',
    'Inondation',
    'list',
    '',
    [
      ['0', 'Sec'],
      ['100', 'Inondation'],
    ],
    ['0', 'Sec', '255'],
    undefined,
    '255',
  ],
  [
    '1061016',
    'Télécommande salon',
    'salon',
    '52',
    'Interrupteur/Télécommande',
    'float',
    ' ',
    [],
    ['1', 'Simple appui', '70'],
    undefined,
    '70',
  ],
  ['1061017', 'Humidité salle de bain', 'sdb', '22', 'Humidité', 'float', '%', [], ['64', '']],
  [
    '1061018',
    'Compteur Linky',
    'garage',
    '26',
    'Consommation',
    'float',
    'kWh',
    [],
    ['15234.6', ''],
  ],
  ['1061019', 'Pression', 'jardin', '32', 'Pression', 'float', 'hPa', [], ['1013.2', '']],
  ['1061020', 'CO2 salon', 'salon', '35', 'Autre indicateur', 'float', 'ppm', [], ['640', '']],
  [
    '1061021',
    'Phase de la journée',
    'hidden',
    '34',
    'Phase',
    'list',
    '',
    [
      ['0', 'Nuit'],
      ['1', 'Journée'],
      ['2', 'Soirée'],
    ],
    ['1', 'Journée'],
  ],
  [
    '1061022',
    'Mode alarme',
    'entree',
    '16',
    'Armement alarme',
    'list',
    '',
    [
      ['0', 'Désactivée'],
      ['1', 'Partielle'],
      ['2', 'Totale'],
    ],
    ['0', 'Désactivée'],
  ],
  [
    '1061023',
    'Lampe jardin',
    'jardin',
    '1',
    'Lampe',
    'list',
    '',
    ON_OFF,
    ['unreachable', 'Non joignable'],
  ],
  ['1061024', 'Messages box', 'hidden', '23', 'Messages', 'string', '', [], ['Tout va bien', '']],
  ['1061025', 'Widget météo', 'jardin', '0', 'Contenu HTML', '', '', [], ['', '']],
  ['1061026', 'Pluie', 'jardin', '41', 'Précipitations', 'float', 'mm/j', [], ['2.4', '']],
  [
    '1061027',
    'Station extérieure batterie',
    'jardin',
    '7',
    'Température',
    'float',
    '%',
    [],
    ['58', ''],
  ],
  [
    '1061028',
    "Compteur d'eau",
    'garage',
    '25',
    "Compteur d'eau",
    'float',
    'm3',
    [],
    ['412.71', ''],
  ],
];

const pad = (n) => String(n).padStart(2, '0');

/** A `last_value_change` of the box: local time, to the second. */
export const stamp = (seconds) => {
  const d = new Date(seconds * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};

/** The time of the box in the fixtures (seconds). */
export const CLOCK = 1_792_092_000;

/** Fresh answers (the tests change them). */
export function answers() {
  const list = [];
  const values = [];
  const caract = [];
  PERIPHERALS.forEach((entry, i) => {
    const [id, name, room, usageId, usageName, valueType, unit, allowed, current, parent, battery] =
      entry;
    const [roomId, roomName] = ROOMS[room];
    list.push({
      periph_id: id,
      parent_periph_id: parent ?? '',
      name,
      value_type: valueType,
      unit,
      room_id: roomId,
      room_name: roomName,
      usage_id: usageId,
      usage_name: usageName,
      icon: '',
      creation_date: '2024-03-02 10:00:00',
      battery: battery ?? '',
    });
    values.push({
      periph_id: id,
      values: allowed.map(([value, description]) => ({ value, description, icon: '' })),
    });
    const [lastValue, lastText, level] = current;
    caract.push({
      periph_id: id,
      name,
      last_value: lastValue,
      last_value_text: lastText,
      battery: level ?? '',
      last_value_change: stamp(CLOCK - 3600 + i),
    });
  });
  return { list, values, caract };
}
