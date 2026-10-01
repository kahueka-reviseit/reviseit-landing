import styles from './tag.module.css';

/**
 * Bloom's category label (Paper K08). Bloom's is the only cognitive model. This shows a
 * category the caller already knows; it never classifies and never fills in a missing one.
 */
const tones:Record<string,string> = {
  remember:styles['tag--remember'], understand:styles['tag--understand'], apply:styles['tag--apply'], analyse:styles['tag--analyse'],
  evaluate:styles['tag--evaluate'], create:styles['tag--create'], grouped:styles['tag--grouped'], unclassified:styles['tag--unclassified'],
};
/** The colour class for a category, also used by proportional bars. Unknown names have no colour. */
export const bloomTone = (category:string):string|undefined => tones[category.toLowerCase()];
export function BloomTag({bloom,tone,title,className}:{bloom:string;tone?:string;title?:string;className?:string}) {
  return <span className={`${styles['tag']} ${bloomTone(tone??bloom)??tones.unclassified}${className?` ${className}`:''}`} title={title}>{bloom}</span>;
}
