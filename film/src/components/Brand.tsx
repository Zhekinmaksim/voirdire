import React from 'react';
import {Img, staticFile} from 'remotion';
import brand from '../brand.json';

/** Same unchanged PNG and visible viewport as the production website. */
export const Brand: React.FC<{width: number; style?: React.CSSProperties}> = ({width, style}) => {
  const view = brand.lockup_view;
  const scale = width / view.width;
  const src = staticFile(`brand/${brand.asset}`);
  return (
    <div style={{position:'relative',width,height:view.height*scale,flexShrink:0,overflow:'hidden',...style}}>
      <Img
        src={src}
        alt="Voirdire"
        style={{position:'absolute',width:brand.width*scale,height:brand.height*scale,left:-view.x*scale,top:-view.y*scale,maskImage:`url("${src}")`,maskMode:'luminance',maskSize:'100% 100%',maskRepeat:'no-repeat'}}
      />
    </div>
  );
};
