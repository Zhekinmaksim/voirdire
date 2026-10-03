import {loadFont} from '@remotion/fonts';
import {cancelRender, staticFile} from 'remotion';

// A failed font load must fail the render, rather than silently use OS fonts.
Promise.all([
  loadFont({family:'Voirdire Geist', url:staticFile('fonts/Geist-Regular.woff2'), weight:'400'}),
  loadFont({family:'Voirdire Geist Mono', url:staticFile('fonts/GeistMono-Regular.woff2'), weight:'400'}),
]).catch(cancelRender);
