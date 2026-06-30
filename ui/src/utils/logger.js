const TAG = "[poke-coach]";

export const logger = {
  info:  (...a) => console.log(TAG, ...a),
  warn:  (...a) => console.warn(TAG, ...a),
  error: (...a) => console.error(TAG, ...a),
  group: (label) => console.group(`${TAG} ${label}`),
  groupEnd: () => console.groupEnd(),
};
