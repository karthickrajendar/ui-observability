import nx from '@nx/eslint-plugin';
import base from '../../eslint.config.mjs';
export default [...nx.configs['flat/react'], ...base];
