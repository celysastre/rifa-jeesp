import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey:            'AIzaSyCHU6tCiGmjBu8T8WururA-rDuXT2-HDDc',
  authDomain:        'rifa-90b39.firebaseapp.com',
  projectId:         'rifa-90b39',
  storageBucket:     'rifa-90b39.firebasestorage.app',
  messagingSenderId: '473332103898',
  appId:             '1:473332103898:web:efb037da218669b5c143e3',
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

/**
 * Observa o documento numbers/status em tempo real.
 * Chama callback(statusMap) sempre que houver mudança.
 * statusMap = { "1": "available"|"reserved"|"sold", ... }
 */
export function watchNumbers(callback) {
  const ref = doc(db, 'numbers', 'status');
  return onSnapshot(ref, (snap) => {
    callback(snap.exists() ? snap.data() : {});
  });
}
