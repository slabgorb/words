const PIP = { A:1, '2':2, '3':3, '4':4, '5':5, '6':6, '7':7, '8':8, '9':9, T:10, J:10, Q:10, K:10 };
const RUN = { A:1, '2':2, '3':3, '4':4, '5':5, '6':6, '7':7, '8':8, '9':9, T:10, J:11, Q:12, K:13 };

export function pipValue(card) { return PIP[card.rank]; }
export function runValue(card) { return RUN[card.rank]; }
