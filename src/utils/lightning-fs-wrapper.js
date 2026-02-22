// Wrapper for @isomorphic-git/lightning-fs
import lightning_fsRaw from '@isomorphic-git/lightning-fs';
const lightning_fs = lightning_fsRaw.default || lightning_fsRaw;
export default lightning_fs;
