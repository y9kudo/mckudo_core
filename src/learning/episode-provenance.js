import {createHash} from 'node:crypto';
export const episodeHash=id=>createHash('sha256').update(id).digest('hex').slice(0,32);
// Core episodes use session:counter; all episodes in a training session stay excluded from evaluation.
export const episodeNamespaceHash=id=>episodeHash(id.includes(':')?id.slice(0,id.lastIndexOf(':')):id);
