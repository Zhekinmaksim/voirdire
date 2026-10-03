import {Config} from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
// The page is almost entirely gradients and grain. A higher CRF band here is
// visibly worse than on flat graphics, so the default is nudged up.
Config.setCrf(20);
