import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(cleanup);
// The paper journey keeps its screen in the address and its draft marks in this
// browser; reset both so one test cannot leak its place or marks into the next.
afterEach(()=>{try{window.history.replaceState(null,'','/');localStorage.clear();}catch{}});
