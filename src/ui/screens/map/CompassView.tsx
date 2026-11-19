/**
 * Boussole : cadran qui tourne avec le téléphone, cap en degrés, nord
 * magnétique ou géographique (déclinaison du modèle embarqué), et cap fixé
 * à suivre. Fonctionne sans réseau : seul le capteur du téléphone sert ; la
 * position n'est utile que pour la déclinaison.
 */
import { Crosshair, LocateFixed } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';

import type { Position } from '../../../device/location';
import {
  describeOffset,
  displayedHeading,
  headingOffset,
  ON_COURSE_DEGREES,
} from '../../../geo/heading';
import { cardinal } from '../../../geo/waypoints';
import { Button, Chip, Notice, Panel } from '../../components/controls';
import { formatNumber } from '../../format';
import { useSession } from '../../session';
import { colors, fonts, sizes, space, text } from '../../theme';

type Reference = 'magnetic' | 'true';

const CARDINAL_MARKS: Array<[number, string]> = [
  [0, 'N'],
  [90, 'E'],
  [180, 'S'],
  [270, 'O'],
];

/**
 * Cadran : la graduation tourne pour que le nord reste vers le nord ; le
 * repère orange, fixe en haut, montre le cap du haut du téléphone. Les
 * lettres et les chiffres restent droits, lisibles quel que soit le cap.
 */
function Dial(props: { heading: number; target: number | null; size: number }) {
  const { size, heading } = props;
  const c = size / 2;
  const ring = c - 6;
  const ticks = Array.from({ length: 72 }, (_, i) => {
    const deg = i * 5;
    const a = (deg * Math.PI) / 180;
    const major = deg % 30 === 0;
    const mid = !major && deg % 10 === 0;
    const r1 = ring - (major ? 18 : mid ? 12 : 7);
    return (
      <Line
        key={deg}
        x1={c + r1 * Math.sin(a)}
        y1={c - r1 * Math.cos(a)}
        x2={c + ring * Math.sin(a)}
        y2={c - ring * Math.cos(a)}
        stroke={major ? colors.text : colors.textSubtle}
        strokeWidth={major ? 2.5 : 1.2}
      />
    );
  });
  const labels = Array.from({ length: 12 }, (_, i) => i * 30).map(deg => {
    const mark = CARDINAL_MARKS.find(([d]) => d === deg);
    const r = ring - (mark ? 40 : 34);
    const a = (deg * Math.PI) / 180;
    return (
      <SvgText
        key={deg}
        x={c + r * Math.sin(a)}
        y={c - r * Math.cos(a)}
        fill={
          mark?.[1] === 'N'
            ? colors.danger
            : mark
            ? colors.text
            : colors.textMuted
        }
        fontSize={mark ? size * 0.09 : size * 0.045}
        fontWeight={mark ? '800' : '600'}
        textAnchor="middle"
        alignmentBaseline="middle"
        rotation={heading}
        origin={`${c + r * Math.sin(a)}, ${c - r * Math.cos(a)}`}
      >
        {mark ? mark[1] : String(deg)}
      </SvgText>
    );
  });
  const targetMark =
    props.target === null ? null : (
      <G rotation={props.target} origin={`${c}, ${c}`}>
        <Path
          d={`M${c} ${c - ring + 2} L${c + 9} ${c - ring + 20} L${c - 9} ${
            c - ring + 20
          } Z`}
          fill={colors.cyan}
        />
      </G>
    );
  return (
    <Svg width={size} height={size}>
      <Circle
        cx={c}
        cy={c}
        r={ring}
        fill={colors.surface}
        stroke={colors.border}
        strokeWidth={2}
      />
      <G rotation={-heading} origin={`${c}, ${c}`}>
        {ticks}
        {labels}
        {targetMark}
      </G>
      {/* Repère fixe : le cap du haut du téléphone. */}
      <Path
        d={`M${c} ${c - ring + 24} L${c + 11} ${c - ring - 4} L${c - 11} ${
          c - ring - 4
        } Z`}
        fill={colors.primary}
      />
      <Line
        x1={c}
        y1={c - 16}
        x2={c}
        y2={c + 16}
        stroke={colors.textMuted}
        strokeWidth={1.5}
      />
      <Line
        x1={c - 16}
        y1={c}
        x2={c + 16}
        y2={c}
        stroke={colors.textMuted}
        strokeWidth={1.5}
      />
    </Svg>
  );
}

export function CompassView(props: {
  here: Position | null;
  locate: () => Promise<Position | null>;
  locating: boolean;
  gpsError: string | null;
}) {
  const { compass } = useSession();
  const { width } = useWindowDimensions();
  const [magnetic, setMagnetic] = useState<number | null>(null);
  const [unreliable, setUnreliable] = useState(false);
  const [declination, setDeclination] = useState<number | null>(null);
  const [reference, setReference] = useState<Reference>('magnetic');
  // Cap fixé, gardé en magnétique : il ne bouge pas si l'on change de nord.
  const [target, setTarget] = useState<number | null>(null);

  useEffect(
    () =>
      compass.watch(reading => {
        setMagnetic(reading.heading);
        setUnreliable(reading.unreliable);
      }),
    [compass],
  );

  const lat = props.here?.latitude;
  const lon = props.here?.longitude;
  useEffect(() => {
    if (lat === undefined || lon === undefined) {
      return undefined;
    }
    let live = true;
    compass.declination(lat, lon).then(d => {
      if (live) {
        setDeclination(d);
      }
    });
    return () => {
      live = false;
    };
  }, [compass, lat, lon]);

  if (!compass.available) {
    return (
      <>
        <Notice
          tone="error"
          message="Ce téléphone n’a pas de capteur de boussole."
        />
        <Text style={text.subtle}>
          Pour s’orienter sans boussole (soleil, montre, étoiles), voir la fiche
          « S’orienter sans boussole » dans Guides.
        </Text>
      </>
    );
  }

  const size = Math.min(width - 2 * sizes.screenPadding, 320);
  const shown =
    magnetic === null
      ? null
      : displayedHeading(magnetic, declination, reference);
  const offset =
    magnetic === null || target === null
      ? null
      : headingOffset(target, magnetic);
  // Le cap fixé, dans la référence affichée.
  const targetShown =
    target === null ? null : displayedHeading(target, declination, reference);
  const trueMissing = reference === 'true' && declination === null;

  return (
    <>
      <View style={styles.refs}>
        <Chip
          label="Nord magnétique"
          selected={reference === 'magnetic'}
          onPress={() => setReference('magnetic')}
        />
        <Chip
          label="Nord géographique"
          selected={reference === 'true'}
          onPress={() => setReference('true')}
        />
      </View>

      <View
        style={styles.readout}
        accessible
        accessibilityLabel={
          shown === null
            ? 'Boussole en attente du capteur'
            : `Cap ${Math.round(shown) % 360} degrés, ${cardinal(shown)}`
        }
      >
        <Text style={styles.degrees}>
          {shown === null ? '—' : `${Math.round(shown) % 360}°`}
        </Text>
        <Text style={styles.cardinal}>
          {shown === null ? 'Lecture du capteur…' : cardinal(shown)}
        </Text>
      </View>

      <View style={styles.dial}>
        <Dial heading={shown ?? 0} target={targetShown} size={size} />
      </View>

      {unreliable ? (
        <Text style={styles.warn}>
          Boussole imprécise : décrivez un « 8 » avec le téléphone, loin du
          métal.
        </Text>
      ) : null}

      {trueMissing ? (
        <Panel>
          <Text style={text.subtle}>
            Le nord géographique demande la déclinaison du lieu, calculée sur le
            téléphone à partir de votre position. En attendant, le cap affiché
            reste magnétique.
          </Text>
          <Button
            compact
            icon={LocateFixed}
            label={props.locating ? 'Recherche du GPS…' : 'Prendre ma position'}
            disabled={props.locating}
            onPress={() => {
              void props.locate();
            }}
          />
          {props.gpsError ? (
            <Notice tone="error" message={props.gpsError} />
          ) : null}
        </Panel>
      ) : null}

      {offset !== null && targetShown !== null ? (
        <Panel accent={colors.cyan}>
          <Text style={text.label}>
            Cap fixé : {Math.round(targetShown) % 360}° ·{' '}
            {cardinal(targetShown)}
          </Text>
          <Text
            style={[
              styles.offset,
              Math.abs(offset) <= ON_COURSE_DEGREES && styles.onCourse,
            ]}
          >
            {describeOffset(offset)}
          </Text>
          <Text style={text.subtle}>
            Tournez-vous jusqu’à aligner le repère cyan sous le repère orange.
          </Text>
        </Panel>
      ) : null}

      <Button
        variant={target === null ? 'primary' : 'secondary'}
        icon={Crosshair}
        label={target === null ? 'Fixer ce cap' : 'Effacer le cap fixé'}
        accessibilityLabel={
          target === null
            ? 'Fixer le cap actuel pour le suivre'
            : 'Effacer le cap fixé'
        }
        disabled={magnetic === null}
        onPress={() => setTarget(t => (t === null ? magnetic : null))}
      />

      <Text style={text.subtle}>
        Tenez le téléphone à plat, haut de l’écran devant vous, loin du métal,
        des aimants (coque aimantée, voiture) et des câbles électriques.
        {reference === 'true' && declination !== null
          ? ` Déclinaison du lieu : ${formatNumber(declination)}°.`
          : ''}
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  refs: { flexDirection: 'row', gap: space.s, flexWrap: 'wrap' },
  readout: { alignItems: 'center', gap: 2 },
  degrees: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 56,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  cardinal: { color: colors.textMuted, fontSize: 16, fontWeight: '600' },
  dial: { alignItems: 'center' },
  warn: { color: colors.warning, fontSize: 14, fontWeight: '600' },
  offset: { color: colors.cyanSoft, fontSize: 22, fontWeight: '700' },
  onCourse: { color: colors.success },
});
