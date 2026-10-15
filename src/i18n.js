// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, button, badges), in English and
// French. Never put the API secret or a URL in one of them.
// -----------------------------------------------------------------------------

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const PORTAL = {
  en: 'secure.eedomus.com → Configuration → Mon compte → Identifiants API',
  fr: 'secure.eedomus.com → Configuration → Mon compte → Identifiants API',
};

/** The two ways, named for the user. */
function way(transport, host) {
  return transport === 'local'
    ? { en: `the eedomus box (${host})`, fr: `la box eedomus (${host})` }
    : { en: 'the eedomus cloud', fr: 'le cloud eedomus' };
}

const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Why a way does not answer, with the hint that fits. */
function unreachable(err, transport, host) {
  const reason = err?.message ?? 'unknown error';
  const who = way(transport, host);
  const hint =
    transport === 'local'
      ? {
          en: 'Check its IP address, seen from the Gladys machine (not localhost). Retrying in a few seconds.',
          fr: 'Vérifiez son adresse IP, vue depuis la machine Gladys (pas localhost). Nouvel essai dans quelques secondes.',
        }
      : {
          en: 'Check the internet access of the Gladys machine. Retrying in a few seconds.',
          fr: "Vérifiez l'accès à internet de la machine Gladys. Nouvel essai dans quelques secondes.",
        };
  const message = {
    en: `${capital(who.en)} is unreachable: ${reason}.`,
    fr: `${capital(who.fr)} est injoignable : ${reason}.`,
  };
  if (err?.fallbackError) {
    const other = way(transport === 'local' ? 'cloud' : 'local', host);
    message.en += ` ${capital(other.en)} did not answer either: ${err.fallbackError.message}.`;
    message.fr += ` ${capital(other.fr)} n'a pas répondu non plus : ${err.fallbackError.message}.`;
  }
  return { en: `${message.en} ${hint.en}`, fr: `${message.fr} ${hint.fr}` };
}

export const T = {
  notConfigured: {
    en: `Type the API user and the API secret of your eedomus (${PORTAL.en}), and the IP address of the box for the local connection.`,
    fr: `Saisissez l'utilisateur et le secret d'API de votre eedomus (${PORTAL.fr}), et l'adresse IP de la box pour la connexion locale.`,
  },
  noCredentials: {
    en: `Type both the API user and the API secret of your eedomus (${PORTAL.en}).`,
    fr: `Saisissez l'utilisateur et le secret d'API de votre eedomus (${PORTAL.fr}).`,
  },
  badAddress(reason) {
    if (reason === 'credentials') {
      return {
        en: 'No user, password or secret in the address of the box: the API credentials have their own fields.',
        fr: "Pas d'utilisateur, de mot de passe ni de secret dans l'adresse de la box : les identifiants d'API ont leurs propres champs.",
      };
    }
    if (reason === 'cloud') {
      return {
        en: 'Type the IP address of the box on your network (like 192.168.1.30), not an eedomus.com address. Leave it empty to go through the eedomus cloud only.',
        fr: "Saisissez l'adresse IP de la box sur votre réseau (comme 192.168.1.30), pas une adresse eedomus.com. Laissez-la vide pour passer uniquement par le cloud eedomus.",
      };
    }
    return {
      en: 'The address of the box is not valid: type its IP address on your network, like 192.168.1.30.',
      fr: "L'adresse de la box n'est pas valide : saisissez son adresse IP sur votre réseau, comme 192.168.1.30.",
    };
  },
  /** The status of a configuration error (see normalizeConfig). */
  configError(error) {
    if (error === 'empty') {
      return T.notConfigured;
    }
    return error === 'no-credentials' ? T.noCredentials : T.badAddress(error);
  },
  connecting: {
    en: 'Connecting to eedomus…',
    fr: 'Connexion à eedomus…',
  },
  /**
   * @param {{ transport: 'local'|'cloud', fallback: boolean, reason?: Error, host?: string, devices: number }} state
   */
  connected({ transport, fallback, reason, host, devices }) {
    const count = {
      en: `${plural(devices, 'device', 'devices')} in Discovery.`,
      fr: `${plural(devices, 'appareil', 'appareils')} dans Découverte.`,
    };
    const why = reason?.message ?? 'no answer';
    if (transport === 'local') {
      const head = {
        en: `Connected to the eedomus box (${host}, local API)`,
        fr: `Connecté à la box eedomus (${host}, API locale)`,
      };
      return fallback
        ? {
            en: `${head.en}: the eedomus cloud does not answer (${why}). ${count.en}`,
            fr: `${head.fr} : le cloud eedomus ne répond pas (${why}). ${count.fr}`,
          }
        : { en: `${head.en}: ${count.en}`, fr: `${head.fr} : ${count.fr}` };
    }
    return fallback
      ? {
          en: `Connected through the eedomus cloud: the box (${host}) does not answer on the local network (${why}). ${count.en} The local connection is tried again every 5 minutes.`,
          fr: `Connecté via le cloud eedomus : la box (${host}) ne répond pas sur le réseau local (${why}). ${count.fr} La connexion locale est retentée toutes les 5 minutes.`,
        }
      : {
          en: `Connected through the eedomus cloud: ${count.en}`,
          fr: `Connecté via le cloud eedomus : ${count.fr}`,
        };
  },
  /**
   * The status of a failed call (an EedomusError).
   * @param {'local'|'cloud'} transport the way that failed first (the preferred one)
   */
  failure(err, transport, host) {
    if (err?.kind === 'auth') {
      return {
        en: `eedomus refused the API credentials: check the API user and the API secret (${PORTAL.en}).`,
        fr: `eedomus a refusé les identifiants d'API : vérifiez l'utilisateur et le secret d'API (${PORTAL.fr}).`,
      };
    }
    if (err?.kind === 'api') {
      return {
        en: `eedomus answered with an error: ${err.message}.`,
        fr: `eedomus a répondu par une erreur : ${err.message}.`,
      };
    }
    return unreachable(err, transport, host);
  },
  test: {
    /**
     * @param {{ checks: Array<{ transport: 'local'|'cloud', error?: Error }>, host?: string, inventory?: { peripherals: number, rooms: number, devices: number, empty: number } }} result
     */
    result({ checks, host, inventory }) {
      const lines = { en: [], fr: [] };
      for (const { transport, error } of checks) {
        const name =
          transport === 'local'
            ? { en: `Local API (${host})`, fr: `API locale (${host})` }
            : { en: 'eedomus cloud', fr: 'Cloud eedomus' };
        if (!error) {
          lines.en.push(`${name.en}: OK.`);
          lines.fr.push(`${name.fr} : OK.`);
        } else if (error.kind === 'auth') {
          lines.en.push(`${name.en}: credentials refused.`);
          lines.fr.push(`${name.fr} : identifiants refusés.`);
        } else {
          lines.en.push(`${name.en}: ${error.message}.`);
          lines.fr.push(`${name.fr} : ${error.message}.`);
        }
      }
      if (inventory) {
        const { peripherals, rooms, devices, empty } = inventory;
        lines.en.push(
          `${plural(peripherals, 'peripheral', 'peripherals')}, ${plural(rooms, 'room', 'rooms')}: ` +
            `${plural(devices, 'device', 'devices')} offered in Discovery` +
            (empty > 0 ? `, ${empty} left out (nothing to offer).` : '.'),
        );
        lines.fr.push(
          `${plural(peripherals, 'périphérique', 'périphériques')}, ${plural(rooms, 'pièce', 'pièces')} : ` +
            `${plural(devices, 'appareil proposé', 'appareils proposés')} dans Découverte` +
            (empty > 0 ? `, ${empty} écarté${empty === 1 ? '' : 's'} (rien à proposer).` : '.'),
        );
      }
      return { en: lines.en.join(' '), fr: lines.fr.join(' ') };
    },
  },
  badge: {
    deviceUnreachable: {
      en: 'The eedomus box cannot reach this device ("Non joignable" in eedomus).',
      fr: "La box eedomus n'arrive pas à joindre ce périphérique (« Non joignable » dans eedomus).",
    },
    viaCloud: {
      en: 'The box does not answer on the local network: through the eedomus cloud, read every minute.',
      fr: 'La box ne répond pas sur le réseau local : via le cloud eedomus, lu chaque minute.',
    },
    viaBox: {
      en: 'The eedomus cloud does not answer: straight through the box on the local network.',
      fr: 'Le cloud eedomus ne répond pas : directement via la box sur le réseau local.',
    },
  },
};
