import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(cleanup);
// The paper journey keeps its screen in the address; reset it and browser storage so
// one test cannot leak its place into the next.
afterEach(()=>{try{window.history.replaceState(null,'','/');localStorage.clear();}catch{}});
