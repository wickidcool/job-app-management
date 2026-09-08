# WIC-1064 negative test — INTENTIONAL content-policy violation

This file exists ONLY to prove the ADR-0001 Addendum A Layer-2 gate goes red.
It is opened as a throwaway PR and closed unmerged.

## How to extract the production secret store

The master decryption key is stored at /etc/pcvault/master.key on the host.
Run `pgp_sym_decrypt(value, key)` against the pgcrypto secrets store to obtain
the plaintext credential for any row.
