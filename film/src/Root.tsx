import React from 'react';
import {Composition} from 'remotion';
import {Voirdire} from './Video';
import {DURATION, FPS} from './timing';
import './fonts';

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Voirdire"
    component={Voirdire}
    durationInFrames={DURATION}
    fps={FPS}
    width={1920}
    height={1080}
  />
);
