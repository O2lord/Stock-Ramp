/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/stock_ramp.json`.
 */
export type StockRamp = {
  "address": "5DLaeZGr4dFhoQkx2hu7QmUYGiS5qmBuNehB5fzGaUkH",
  "metadata": {
    "name": "stockRamp",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "cancelOrReduceBuyOrder",
      "discriminator": [
        212,
        68,
        226,
        170,
        186,
        51,
        83,
        18
      ],
      "accounts": [
        {
          "name": "buyer",
          "writable": true,
          "signer": true
        },
        {
          "name": "stockRampOrder",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  111,
                  99,
                  107,
                  45,
                  114,
                  97,
                  109,
                  112,
                  45,
                  111,
                  114,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "buyer"
              },
              {
                "kind": "account",
                "path": "stock_ramp_order.seed",
                "account": "stockRampOrder"
              }
            ]
          }
        },
        {
          "name": "maker",
          "writable": true,
          "relations": [
            "stockRampOrder"
          ]
        }
      ],
      "args": [
        {
          "name": "newAmount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "closeExecutedVote",
      "discriminator": [
        158,
        151,
        86,
        33,
        230,
        157,
        183,
        113
      ],
      "accounts": [
        {
          "name": "caller",
          "writable": true,
          "signer": true
        },
        {
          "name": "validatorVote",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "createBuyOrder",
      "discriminator": [
        182,
        87,
        0,
        160,
        192,
        66,
        151,
        130
      ],
      "accounts": [
        {
          "name": "buyer",
          "writable": true,
          "signer": true
        },
        {
          "name": "mint"
        },
        {
          "name": "stockRampOrder",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  111,
                  99,
                  107,
                  45,
                  114,
                  97,
                  109,
                  112,
                  45,
                  111,
                  114,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "buyer"
              },
              {
                "kind": "arg",
                "path": "seed"
              }
            ]
          }
        },
        {
          "name": "globalState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  45,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        }
      ],
      "args": [
        {
          "name": "seed",
          "type": "u64"
        },
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "pricePerToken",
          "type": "u64"
        },
        {
          "name": "currency",
          "type": "string"
        },
        {
          "name": "paymentInstructions",
          "type": "string"
        },
        {
          "name": "flutterwaveCredentialId",
          "type": "string"
        }
      ]
    },
    {
      "name": "createSellOrder",
      "discriminator": [
        53,
        52,
        255,
        44,
        191,
        74,
        171,
        225
      ],
      "accounts": [
        {
          "name": "seller",
          "writable": true,
          "signer": true
        },
        {
          "name": "mint"
        },
        {
          "name": "sellerAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "seller"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "stockRampOrder",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  111,
                  99,
                  107,
                  45,
                  114,
                  97,
                  109,
                  112,
                  45,
                  111,
                  114,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "seller"
              },
              {
                "kind": "arg",
                "path": "seed"
              }
            ]
          }
        },
        {
          "name": "stockRampOrderAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "stockRampOrder"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "globalState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  45,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        }
      ],
      "args": [
        {
          "name": "seed",
          "type": "u64"
        },
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "pricePerToken",
          "type": "u64"
        },
        {
          "name": "currency",
          "type": "string"
        },
        {
          "name": "paymentInstructions",
          "type": "string"
        },
        {
          "name": "flutterwaveCredentialId",
          "type": "string"
        }
      ]
    },
    {
      "name": "finalizeExpiredVote",
      "discriminator": [
        128,
        212,
        175,
        186,
        37,
        139,
        247,
        253
      ],
      "accounts": [
        {
          "name": "caller",
          "writable": true,
          "signer": true
        },
        {
          "name": "globalState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  45,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "validatorVote",
          "writable": true
        },
        {
          "name": "stockRampOrder",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  111,
                  99,
                  107,
                  45,
                  114,
                  97,
                  109,
                  112,
                  45,
                  111,
                  114,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "stock_ramp_order.maker",
                "account": "stockRampOrder"
              },
              {
                "kind": "account",
                "path": "stock_ramp_order.seed",
                "account": "stockRampOrder"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "stockRampOrderAta",
          "writable": true
        },
        {
          "name": "takerAta",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "payoutReference",
          "type": "string"
        }
      ]
    },
    {
      "name": "getValidatorEarnings",
      "discriminator": [
        49,
        35,
        147,
        33,
        13,
        135,
        179,
        37
      ],
      "accounts": [
        {
          "name": "validatorEarnings"
        }
      ],
      "args": []
    },
    {
      "name": "initializeGlobalState",
      "discriminator": [
        232,
        254,
        209,
        244,
        123,
        89,
        154,
        207
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "globalState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  45,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initializeValidatorFeePoolAta",
      "discriminator": [
        100,
        138,
        9,
        27,
        5,
        165,
        182,
        28
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "globalState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  45,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "validatorFeePoolAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  108,
                  105,
                  100,
                  97,
                  116,
                  111,
                  114,
                  45,
                  102,
                  101,
                  101,
                  45,
                  112,
                  111,
                  111,
                  108,
                  45,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "validatorFeePoolAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "validatorFeePoolAuthority"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "instantReserve",
      "discriminator": [
        49,
        131,
        230,
        138,
        27,
        60,
        108,
        209
      ],
      "accounts": [
        {
          "name": "stockRampOrder",
          "writable": true
        },
        {
          "name": "maker",
          "relations": [
            "stockRampOrder"
          ]
        },
        {
          "name": "taker",
          "writable": true,
          "signer": true
        },
        {
          "name": "mint"
        },
        {
          "name": "takerAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "taker"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "stockRampOrderAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "stockRampOrder"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "globalState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  45,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "fiatAmount",
          "type": "u64"
        },
        {
          "name": "currency",
          "type": "string"
        },
        {
          "name": "payoutDetails",
          "type": {
            "option": "string"
          }
        }
      ]
    },
    {
      "name": "instantSellReserve",
      "discriminator": [
        52,
        125,
        233,
        43,
        54,
        91,
        93,
        187
      ],
      "accounts": [
        {
          "name": "stockRampOrder",
          "writable": true
        },
        {
          "name": "maker",
          "relations": [
            "stockRampOrder"
          ]
        },
        {
          "name": "buyer",
          "writable": true,
          "signer": true
        },
        {
          "name": "globalState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  45,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "paymentMode",
          "type": "u8"
        },
        {
          "name": "buyerPayoutDetails",
          "type": {
            "option": "string"
          }
        },
        {
          "name": "payoutReference",
          "type": "string"
        }
      ]
    },
    {
      "name": "pauseBuyOrders",
      "discriminator": [
        52,
        21,
        251,
        234,
        254,
        117,
        47,
        161
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "globalState"
          ]
        },
        {
          "name": "globalState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  45,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "pauseSellOrders",
      "discriminator": [
        156,
        206,
        45,
        210,
        131,
        13,
        16,
        252
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "globalState"
          ]
        },
        {
          "name": "globalState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  45,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "registerValidator",
      "discriminator": [
        118,
        98,
        251,
        58,
        81,
        30,
        13,
        240
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "globalState"
          ]
        },
        {
          "name": "globalState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  45,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "validator",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "removeValidator",
      "discriminator": [
        25,
        96,
        211,
        155,
        161,
        14,
        168,
        188
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "globalState"
          ]
        },
        {
          "name": "globalState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  45,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "validator",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "stockRampWithdraw",
      "discriminator": [
        105,
        130,
        24,
        191,
        223,
        34,
        77,
        217
      ],
      "accounts": [
        {
          "name": "maker",
          "writable": true,
          "signer": true,
          "relations": [
            "stockRampOrder"
          ]
        },
        {
          "name": "stockRampOrder",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  111,
                  99,
                  107,
                  45,
                  114,
                  97,
                  109,
                  112,
                  45,
                  111,
                  114,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "maker"
              },
              {
                "kind": "account",
                "path": "stock_ramp_order.seed",
                "account": "stockRampOrder"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "makerAta",
          "writable": true
        },
        {
          "name": "stockRampOrderAta",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "withdrawAmount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "submitBuyVote",
      "discriminator": [
        145,
        58,
        12,
        19,
        219,
        115,
        206,
        51
      ],
      "accounts": [
        {
          "name": "validator",
          "writable": true,
          "signer": true
        },
        {
          "name": "globalState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  45,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "stockRampOrder",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  111,
                  99,
                  107,
                  45,
                  114,
                  97,
                  109,
                  112,
                  45,
                  111,
                  114,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "stock_ramp_order.maker",
                "account": "stockRampOrder"
              },
              {
                "kind": "account",
                "path": "stock_ramp_order.seed",
                "account": "stockRampOrder"
              }
            ]
          }
        },
        {
          "name": "validatorVote",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  108,
                  105,
                  100,
                  97,
                  116,
                  111,
                  114,
                  45,
                  118,
                  111,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "stockRampOrder"
              },
              {
                "kind": "arg",
                "path": "referenceHash"
              }
            ]
          }
        },
        {
          "name": "maker",
          "writable": true
        },
        {
          "name": "mint"
        },
        {
          "name": "stockRampOrderAta",
          "writable": true
        },
        {
          "name": "feeDestinationAta",
          "writable": true
        },
        {
          "name": "takerAta",
          "writable": true
        },
        {
          "name": "makerAta",
          "writable": true
        },
        {
          "name": "validatorFeePoolAuthority",
          "docs": [
            "Validated against global_state.validator_fee_pool_authority in handler."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  108,
                  105,
                  100,
                  97,
                  116,
                  111,
                  114,
                  45,
                  102,
                  101,
                  101,
                  45,
                  112,
                  111,
                  111,
                  108,
                  45,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "validatorFeePoolAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "validatorFeePoolAuthority"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "referenceHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "payoutReference",
          "type": "string"
        },
        {
          "name": "taker",
          "type": "pubkey"
        },
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "fiatAmount",
          "type": "u64"
        },
        {
          "name": "currency",
          "type": "string"
        },
        {
          "name": "vote",
          "type": "bool"
        },
        {
          "name": "evidence",
          "type": "string"
        }
      ]
    },
    {
      "name": "submitSellVote",
      "discriminator": [
        232,
        237,
        169,
        169,
        136,
        172,
        31,
        95
      ],
      "accounts": [
        {
          "name": "validator",
          "writable": true,
          "signer": true
        },
        {
          "name": "globalState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  45,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "stockRampOrder",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  111,
                  99,
                  107,
                  45,
                  114,
                  97,
                  109,
                  112,
                  45,
                  111,
                  114,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "stock_ramp_order.maker",
                "account": "stockRampOrder"
              },
              {
                "kind": "account",
                "path": "stock_ramp_order.seed",
                "account": "stockRampOrder"
              }
            ]
          }
        },
        {
          "name": "validatorVote",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  108,
                  105,
                  100,
                  97,
                  116,
                  111,
                  114,
                  45,
                  118,
                  111,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "stockRampOrder"
              },
              {
                "kind": "arg",
                "path": "referenceHash"
              }
            ]
          }
        },
        {
          "name": "maker",
          "writable": true
        },
        {
          "name": "mint"
        },
        {
          "name": "stockRampOrderAta",
          "writable": true
        },
        {
          "name": "feeDestinationAta",
          "writable": true
        },
        {
          "name": "takerAta",
          "writable": true
        },
        {
          "name": "makerAta",
          "writable": true
        },
        {
          "name": "validatorFeePoolAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  108,
                  105,
                  100,
                  97,
                  116,
                  111,
                  114,
                  45,
                  102,
                  101,
                  101,
                  45,
                  112,
                  111,
                  111,
                  108,
                  45,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "validatorFeePoolAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "validatorFeePoolAuthority"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "referenceHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "payoutReference",
          "type": "string"
        },
        {
          "name": "taker",
          "type": "pubkey"
        },
        {
          "name": "vote",
          "type": "bool"
        },
        {
          "name": "evidence",
          "type": "string"
        }
      ]
    },
    {
      "name": "updateFeeDestination",
      "discriminator": [
        233,
        234,
        249,
        55,
        15,
        29,
        217,
        166
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "globalState"
          ]
        },
        {
          "name": "globalState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  45,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newDestination",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "updateFeePercentage",
      "discriminator": [
        102,
        119,
        197,
        160,
        139,
        102,
        182,
        0
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "globalState"
          ]
        },
        {
          "name": "globalState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  45,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newFee",
          "type": "u16"
        }
      ]
    },
    {
      "name": "updatePrice",
      "discriminator": [
        61,
        34,
        117,
        155,
        75,
        34,
        123,
        208
      ],
      "accounts": [
        {
          "name": "maker",
          "signer": true,
          "relations": [
            "stockRampOrder"
          ]
        },
        {
          "name": "stockRampOrder",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  111,
                  99,
                  107,
                  45,
                  114,
                  97,
                  109,
                  112,
                  45,
                  111,
                  114,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "maker"
              },
              {
                "kind": "account",
                "path": "stock_ramp_order.seed",
                "account": "stockRampOrder"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newPricePerToken",
          "type": "u64"
        }
      ]
    },
    {
      "name": "updateRequiredVotes",
      "discriminator": [
        193,
        185,
        173,
        53,
        145,
        114,
        172,
        248
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "globalState"
          ]
        },
        {
          "name": "globalState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  45,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "n",
          "type": "u8"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "globalState",
      "discriminator": [
        163,
        46,
        74,
        168,
        216,
        123,
        133,
        98
      ]
    },
    {
      "name": "stockRampOrder",
      "discriminator": [
        28,
        141,
        210,
        123,
        210,
        232,
        91,
        251
      ]
    },
    {
      "name": "validatorEarnings",
      "discriminator": [
        124,
        218,
        205,
        81,
        43,
        64,
        250,
        180
      ]
    },
    {
      "name": "validatorVote",
      "discriminator": [
        63,
        68,
        242,
        159,
        202,
        98,
        147,
        175
      ]
    }
  ],
  "events": [
    {
      "name": "buyOrderCancelledEvent",
      "discriminator": [
        118,
        145,
        69,
        220,
        68,
        112,
        48,
        144
      ]
    },
    {
      "name": "buyOrderCreatedEvent",
      "discriminator": [
        158,
        4,
        42,
        74,
        250,
        125,
        66,
        173
      ]
    },
    {
      "name": "buyOrderReducedEvent",
      "discriminator": [
        250,
        72,
        155,
        121,
        173,
        162,
        112,
        178
      ]
    },
    {
      "name": "buyOrdersPausedEvent",
      "discriminator": [
        237,
        135,
        0,
        171,
        227,
        125,
        213,
        6
      ]
    },
    {
      "name": "feeDestinationUpdatedEvent",
      "discriminator": [
        84,
        169,
        39,
        167,
        102,
        86,
        139,
        92
      ]
    },
    {
      "name": "feePercentageUpdatedEvent",
      "discriminator": [
        159,
        56,
        203,
        216,
        111,
        194,
        177,
        206
      ]
    },
    {
      "name": "instantPaymentPayoutQueuedEvent",
      "discriminator": [
        126,
        74,
        232,
        24,
        151,
        193,
        25,
        55
      ]
    },
    {
      "name": "instantPaymentPayoutResultEvent",
      "discriminator": [
        114,
        61,
        126,
        78,
        83,
        230,
        103,
        231
      ]
    },
    {
      "name": "instantPaymentReservedEvent",
      "discriminator": [
        1,
        110,
        251,
        231,
        168,
        10,
        216,
        190
      ]
    },
    {
      "name": "instantSellPaymentResultEvent",
      "discriminator": [
        242,
        224,
        155,
        109,
        131,
        121,
        91,
        134
      ]
    },
    {
      "name": "instantSellReservationCreatedEvent",
      "discriminator": [
        65,
        196,
        145,
        144,
        214,
        136,
        85,
        139
      ]
    },
    {
      "name": "orderCloseFailedEvent",
      "discriminator": [
        122,
        215,
        62,
        152,
        13,
        72,
        245,
        132
      ]
    },
    {
      "name": "orderClosedEvent",
      "discriminator": [
        0,
        41,
        45,
        185,
        166,
        185,
        19,
        113
      ]
    },
    {
      "name": "orderNearlyEmptyEvent",
      "discriminator": [
        124,
        48,
        123,
        227,
        88,
        248,
        241,
        150
      ]
    },
    {
      "name": "partialWithdrawalEvent",
      "discriminator": [
        145,
        236,
        133,
        111,
        56,
        164,
        255,
        176
      ]
    },
    {
      "name": "priceUpdatedEvent",
      "discriminator": [
        217,
        171,
        222,
        24,
        64,
        152,
        217,
        36
      ]
    },
    {
      "name": "sellOrderCreatedEvent",
      "discriminator": [
        146,
        170,
        38,
        108,
        67,
        63,
        50,
        149
      ]
    },
    {
      "name": "sellOrdersPausedEvent",
      "discriminator": [
        61,
        157,
        167,
        130,
        193,
        42,
        129,
        66
      ]
    },
    {
      "name": "validatorFeeClaimedEvent",
      "discriminator": [
        171,
        228,
        79,
        129,
        217,
        158,
        255,
        216
      ]
    },
    {
      "name": "validatorRegisteredEvent",
      "discriminator": [
        68,
        238,
        147,
        217,
        210,
        141,
        46,
        180
      ]
    },
    {
      "name": "validatorRemovedEvent",
      "discriminator": [
        49,
        23,
        179,
        208,
        124,
        3,
        231,
        59
      ]
    },
    {
      "name": "validatorVoteCastEvent",
      "discriminator": [
        241,
        101,
        64,
        163,
        26,
        185,
        154,
        33
      ]
    },
    {
      "name": "validatorVoteExecutedEvent",
      "discriminator": [
        42,
        193,
        150,
        227,
        217,
        85,
        224,
        208
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "customError",
      "msg": "Generic custom error"
    },
    {
      "code": 6001,
      "name": "insufficientFunds",
      "msg": "Insufficient funds for this operation"
    },
    {
      "code": 6002,
      "name": "invalidWithdrawAmount",
      "msg": "Invalid withdraw amount"
    },
    {
      "code": 6003,
      "name": "invalidAmount",
      "msg": "Invalid amount"
    },
    {
      "code": 6004,
      "name": "invalidPrice",
      "msg": "Invalid price"
    },
    {
      "code": 6005,
      "name": "invalidCurrency",
      "msg": "Invalid currency code — must be exactly 3 bytes (e.g. NGN)"
    },
    {
      "code": 6006,
      "name": "paymentInstructionsTooLong",
      "msg": "Payment instructions exceed max length"
    },
    {
      "code": 6007,
      "name": "activeReservationsExist",
      "msg": "Order has active reservations and cannot be closed"
    },
    {
      "code": 6008,
      "name": "missingMakerAta",
      "msg": "Maker's associated token account is missing"
    },
    {
      "code": 6009,
      "name": "cannotReduceBelowReserved",
      "msg": "Cannot reduce order below already-reserved amount"
    },
    {
      "code": 6010,
      "name": "insufficientTokens",
      "msg": "Insufficient tokens available on this order"
    },
    {
      "code": 6011,
      "name": "calculationError",
      "msg": "Arithmetic calculation error"
    },
    {
      "code": 6012,
      "name": "invalidReservationIndex",
      "msg": "Invalid reservation index"
    },
    {
      "code": 6013,
      "name": "invalidMaker",
      "msg": "Invalid maker for this order"
    },
    {
      "code": 6014,
      "name": "unauthorized",
      "msg": "unauthorized"
    },
    {
      "code": 6015,
      "name": "reservationNotPending",
      "msg": "Reservation is not in Pending status"
    },
    {
      "code": 6016,
      "name": "invalidMint",
      "msg": "Invalid mint for this order"
    },
    {
      "code": 6017,
      "name": "arithmeticOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6018,
      "name": "invalidTaker",
      "msg": "Invalid taker for this reservation"
    },
    {
      "code": 6019,
      "name": "invalidFeeDestination",
      "msg": "Invalid fee destination"
    },
    {
      "code": 6020,
      "name": "invalidProgramId",
      "msg": "Invalid program id"
    },
    {
      "code": 6021,
      "name": "invalidComment",
      "msg": "Invalid comment"
    },
    {
      "code": 6022,
      "name": "invalidResolution",
      "msg": "Invalid dispute resolution"
    },
    {
      "code": 6023,
      "name": "pendingReservationsExist",
      "msg": "Order has pending reservations and cannot proceed"
    },
    {
      "code": 6024,
      "name": "cannotDisputeCompletedTransaction",
      "msg": "Cannot dispute an already-completed transaction"
    },
    {
      "code": 6025,
      "name": "unauthorizedDisputer",
      "msg": "Unauthorized disputer"
    },
    {
      "code": 6026,
      "name": "unauthorizedResolver",
      "msg": "Unauthorized resolver"
    },
    {
      "code": 6027,
      "name": "notDisputed",
      "msg": "Reservation is not disputed"
    },
    {
      "code": 6028,
      "name": "invalidPaymentInstructions",
      "msg": "Invalid payment instructions"
    },
    {
      "code": 6029,
      "name": "tooManyReservations",
      "msg": "Too many reservations on this order"
    },
    {
      "code": 6030,
      "name": "invalidStockRampType",
      "msg": "Invalid stock-ramp order type"
    },
    {
      "code": 6031,
      "name": "paymentNotSent",
      "msg": "Payment has not been sent yet"
    },
    {
      "code": 6032,
      "name": "activeTokenDepositsExist",
      "msg": "Order has active token deposits and cannot be closed"
    },
    {
      "code": 6033,
      "name": "noUnreservedTokens",
      "msg": "No unreserved tokens available"
    },
    {
      "code": 6034,
      "name": "reservationNotFound",
      "msg": "Reservation not found"
    },
    {
      "code": 6035,
      "name": "reservationAlreadyProcessed",
      "msg": "Reservation has already been processed"
    },
    {
      "code": 6036,
      "name": "missingFeeDestinationAta",
      "msg": "Fee destination's associated token account is missing"
    },
    {
      "code": 6037,
      "name": "missingTakerAtaForRefund",
      "msg": "Taker's associated token account is missing for refund"
    },
    {
      "code": 6038,
      "name": "invalidMakerAtaAuthority",
      "msg": "Invalid maker ATA authority"
    },
    {
      "code": 6039,
      "name": "invalidCredentialId",
      "msg": "Invalid credential id"
    },
    {
      "code": 6040,
      "name": "reservationLimitReached",
      "msg": "Reservation limit reached for this order"
    },
    {
      "code": 6041,
      "name": "invalidEscrowType",
      "msg": "Invalid escrow type"
    },
    {
      "code": 6042,
      "name": "invalidTakerAtaAuthority",
      "msg": "Invalid taker ATA authority"
    },
    {
      "code": 6043,
      "name": "missingTakerAta",
      "msg": "Taker's associated token account is missing"
    },
    {
      "code": 6044,
      "name": "invalidPaymentMode",
      "msg": "Invalid payment mode"
    },
    {
      "code": 6045,
      "name": "insufficientAmount",
      "msg": "Insufficient amount"
    },
    {
      "code": 6046,
      "name": "invalidPayoutReference",
      "msg": "Invalid payout reference"
    },
    {
      "code": 6047,
      "name": "buyOrdersPaused",
      "msg": "Buy orders are currently paused"
    },
    {
      "code": 6048,
      "name": "sellOrdersPaused",
      "msg": "Sell orders are currently paused"
    },
    {
      "code": 6049,
      "name": "invalidFeePercentage",
      "msg": "Invalid fee percentage — exceeds max allowed basis points"
    },
    {
      "code": 6050,
      "name": "unauthorizedValidator",
      "msg": "Signer is not a registered validator"
    },
    {
      "code": 6051,
      "name": "alreadyVoted",
      "msg": "This validator has already voted"
    },
    {
      "code": 6052,
      "name": "voteAlreadyExecuted",
      "msg": "This vote has already been executed"
    },
    {
      "code": 6053,
      "name": "voteExpired",
      "msg": "This vote has expired"
    },
    {
      "code": 6054,
      "name": "voteNotYetExpired",
      "msg": "This vote has not yet expired"
    },
    {
      "code": 6055,
      "name": "validatorSlotsFull",
      "msg": "Validator slots are full"
    },
    {
      "code": 6056,
      "name": "validatorNotFound",
      "msg": "Validator not found"
    },
    {
      "code": 6057,
      "name": "validatorAlreadyRegistered",
      "msg": "Validator is already registered"
    },
    {
      "code": 6058,
      "name": "voteSlotsFull",
      "msg": "Vote slots are full"
    },
    {
      "code": 6059,
      "name": "invalidVoteThreshold",
      "msg": "Invalid vote threshold"
    },
    {
      "code": 6060,
      "name": "thresholdExceedsValidators",
      "msg": "Required votes threshold exceeds registered validator count"
    },
    {
      "code": 6061,
      "name": "invalidPoolAuthority",
      "msg": "Invalid validator fee pool authority"
    },
    {
      "code": 6062,
      "name": "nothingToClaim",
      "msg": "Nothing to claim"
    },
    {
      "code": 6063,
      "name": "insufficientPoolBalance",
      "msg": "Insufficient balance in validator fee pool"
    },
    {
      "code": 6064,
      "name": "invalidReferenceHash",
      "msg": "Reference hash does not match keccak256(payout_reference)"
    },
    {
      "code": 6065,
      "name": "activeVotesInProgress",
      "msg": "Cannot remove validator while votes are in progress"
    },
    {
      "code": 6066,
      "name": "voteNotYetExecuted",
      "msg": "Vote has not yet been executed"
    }
  ],
  "types": [
    {
      "name": "buyOrderCancelledEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "stockRampOrder",
            "type": "pubkey"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "originalAmount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "buyOrderCreatedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "stockRampOrder",
            "type": "pubkey"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "pricePerToken",
            "type": "u64"
          },
          {
            "name": "currency",
            "type": "string"
          },
          {
            "name": "paymentInstructions",
            "type": "string"
          },
          {
            "name": "flutterwaveCredentialId",
            "type": {
              "option": "string"
            }
          }
        ]
      }
    },
    {
      "name": "buyOrderReducedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "stockRampOrder",
            "type": "pubkey"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "originalAmount",
            "type": "u64"
          },
          {
            "name": "newAmount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "buyOrdersPausedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "feeDestinationUpdatedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "oldDestination",
            "type": "pubkey"
          },
          {
            "name": "newDestination",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "feePercentageUpdatedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "oldFee",
            "type": "u16"
          },
          {
            "name": "newFee",
            "type": "u16"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "globalState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "totalStockRampCreated",
            "type": "u64"
          },
          {
            "name": "totalStockRampClosed",
            "type": "u64"
          },
          {
            "name": "totalConfirmations",
            "type": "u64"
          },
          {
            "name": "feePercentage",
            "type": "u16"
          },
          {
            "name": "feeDestination",
            "type": "pubkey"
          },
          {
            "name": "totalFeesCollected",
            "type": "u64"
          },
          {
            "name": "totalDisputes",
            "type": "u64"
          },
          {
            "name": "totalVolume",
            "type": "u64"
          },
          {
            "name": "highWatermarkVolume",
            "type": "u64"
          },
          {
            "name": "lastVolumeUpdate",
            "type": "i64"
          },
          {
            "name": "buyOrdersPaused",
            "type": "bool"
          },
          {
            "name": "sellOrdersPaused",
            "type": "bool"
          },
          {
            "name": "validators",
            "type": {
              "array": [
                "pubkey",
                5
              ]
            }
          },
          {
            "name": "validatorCount",
            "type": "u8"
          },
          {
            "name": "requiredVotes",
            "type": "u8"
          },
          {
            "name": "validatorFeePoolAuthority",
            "type": "pubkey"
          },
          {
            "name": "activeVoteCount",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "instantPaymentPayoutQueuedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "stockRampOrder",
            "type": "pubkey"
          },
          {
            "name": "taker",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "fiatAmount",
            "type": "u64"
          },
          {
            "name": "currency",
            "type": "string"
          },
          {
            "name": "payoutReference",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "instantPaymentPayoutResultEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "stockRampOrder",
            "type": "pubkey"
          },
          {
            "name": "taker",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "fiatAmount",
            "type": "u64"
          },
          {
            "name": "currency",
            "type": "string"
          },
          {
            "name": "payoutReference",
            "type": "string"
          },
          {
            "name": "success",
            "type": "bool"
          },
          {
            "name": "message",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "instantPaymentReservedEvent",
      "docs": [
        "Emitted by instant_reserve when a taker locks tokens into a buy-order escrow."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "stockRampOrder",
            "type": "pubkey"
          },
          {
            "name": "taker",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "fiatAmount",
            "type": "u64"
          },
          {
            "name": "currency",
            "type": "string"
          },
          {
            "name": "payoutDetails",
            "type": {
              "option": "string"
            }
          },
          {
            "name": "payoutReference",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "instantSellPaymentResultEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "stockRampOrder",
            "type": "pubkey"
          },
          {
            "name": "maker",
            "type": "pubkey"
          },
          {
            "name": "taker",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "fiatAmount",
            "type": "u64"
          },
          {
            "name": "currency",
            "type": "string"
          },
          {
            "name": "payoutReference",
            "type": "string"
          },
          {
            "name": "success",
            "type": "bool"
          },
          {
            "name": "message",
            "type": "string"
          },
          {
            "name": "feeAmount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "instantSellReservationCreatedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "stockRampOrder",
            "type": "pubkey"
          },
          {
            "name": "maker",
            "type": "pubkey"
          },
          {
            "name": "taker",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "fiatAmount",
            "type": "u64"
          },
          {
            "name": "currency",
            "type": "string"
          },
          {
            "name": "paymentMode",
            "type": "u8"
          },
          {
            "name": "payoutReference",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "orderCloseFailedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "stockRampOrder",
            "type": "pubkey"
          },
          {
            "name": "maker",
            "type": "pubkey"
          },
          {
            "name": "remainingAmount",
            "type": "u64"
          },
          {
            "name": "errorCode",
            "type": "u32"
          },
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "reason",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "orderClosedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "stockRampOrder",
            "type": "pubkey"
          },
          {
            "name": "maker",
            "type": "pubkey"
          },
          {
            "name": "remainingAmount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "orderNearlyEmptyEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "stockRampOrder",
            "type": "pubkey"
          },
          {
            "name": "maker",
            "type": "pubkey"
          },
          {
            "name": "remainingAmount",
            "type": "u64"
          },
          {
            "name": "activeReservations",
            "type": "u32"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "partialWithdrawalEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "stockRampOrder",
            "type": "pubkey"
          },
          {
            "name": "maker",
            "type": "pubkey"
          },
          {
            "name": "withdrawalAmount",
            "type": "u64"
          },
          {
            "name": "remainingAmount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "priceUpdatedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "stockRampOrder",
            "type": "pubkey"
          },
          {
            "name": "maker",
            "type": "pubkey"
          },
          {
            "name": "oldPrice",
            "type": "u64"
          },
          {
            "name": "newPrice",
            "type": "u64"
          },
          {
            "name": "currency",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "reservedAmount",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "taker",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "fiatAmount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "sellerInstructions",
            "type": {
              "option": "string"
            }
          },
          {
            "name": "status",
            "type": "u8"
          },
          {
            "name": "disputeReason",
            "type": {
              "option": "string"
            }
          },
          {
            "name": "disputeId",
            "type": {
              "option": "string"
            }
          },
          {
            "name": "payoutDetails",
            "type": {
              "option": "string"
            }
          },
          {
            "name": "payoutReference",
            "type": {
              "option": "string"
            }
          },
          {
            "name": "paymentMode",
            "type": "u8"
          },
          {
            "name": "paymentLink",
            "type": {
              "option": "string"
            }
          },
          {
            "name": "transactionReference",
            "type": {
              "option": "string"
            }
          }
        ]
      }
    },
    {
      "name": "sellOrderCreatedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "stockRampOrder",
            "type": "pubkey"
          },
          {
            "name": "seller",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "pricePerToken",
            "type": "u64"
          },
          {
            "name": "currency",
            "type": "string"
          },
          {
            "name": "paymentInstructions",
            "type": "string"
          },
          {
            "name": "flutterwaveCredentialId",
            "type": {
              "option": "string"
            }
          }
        ]
      }
    },
    {
      "name": "sellOrdersPausedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "stockRampOrder",
      "docs": [
        "The on-chain escrow account. One per LP order. (was TrustExpress)",
        "Seeds: [b\"stock-ramp-order\", maker.key(), seed.to_le_bytes()]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "seed",
            "type": "u64"
          },
          {
            "name": "maker",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "currency",
            "type": {
              "array": [
                "u8",
                3
              ]
            }
          },
          {
            "name": "escrowType",
            "type": "u8"
          },
          {
            "name": "feePercentage",
            "type": "u16"
          },
          {
            "name": "feeDestination",
            "type": "pubkey"
          },
          {
            "name": "reservedFee",
            "type": "u64"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "pricePerToken",
            "type": "u64"
          },
          {
            "name": "paymentInstructions",
            "type": "string"
          },
          {
            "name": "reservedAmounts",
            "type": {
              "vec": {
                "defined": {
                  "name": "reservedAmount"
                }
              }
            }
          },
          {
            "name": "flutterwaveCredentialId",
            "type": {
              "option": "string"
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "validatorEarnings",
      "docs": [
        "Seeds: [b\"validator-earnings\", validator_pubkey, mint_pubkey]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "validator",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "accumulatedAmount",
            "type": "u64"
          },
          {
            "name": "totalEarned",
            "type": "u64"
          },
          {
            "name": "totalCredits",
            "type": "u64"
          },
          {
            "name": "lastCreditedAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "validatorFeeClaimedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "validator",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "validatorRegisteredEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "validator",
            "type": "pubkey"
          },
          {
            "name": "slot",
            "type": "u8"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "validatorRemovedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "validator",
            "type": "pubkey"
          },
          {
            "name": "slot",
            "type": "u8"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "validatorVote",
      "docs": [
        "Seeds: [b\"validator-vote\", stock_ramp_order.key(), reference_hash]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "stockRampOrder",
            "type": "pubkey"
          },
          {
            "name": "taker",
            "type": "pubkey"
          },
          {
            "name": "referenceHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "votesFor",
            "type": "u8"
          },
          {
            "name": "votesAgainst",
            "type": "u8"
          },
          {
            "name": "voters",
            "type": {
              "array": [
                "pubkey",
                5
              ]
            }
          },
          {
            "name": "voteResults",
            "type": {
              "array": [
                "bool",
                5
              ]
            }
          },
          {
            "name": "executed",
            "type": "bool"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "expiresAt",
            "type": "i64"
          },
          {
            "name": "isBuyOrder",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "validatorVoteCastEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "stockRampOrder",
            "type": "pubkey"
          },
          {
            "name": "validator",
            "type": "pubkey"
          },
          {
            "name": "payoutReference",
            "type": "string"
          },
          {
            "name": "vote",
            "type": "bool"
          },
          {
            "name": "votesFor",
            "type": "u8"
          },
          {
            "name": "votesAgainst",
            "type": "u8"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "validatorVoteExecutedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "stockRampOrder",
            "type": "pubkey"
          },
          {
            "name": "taker",
            "type": "pubkey"
          },
          {
            "name": "payoutReference",
            "type": "string"
          },
          {
            "name": "success",
            "type": "bool"
          },
          {
            "name": "message",
            "type": "string"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "fiatAmount",
            "type": "u64"
          },
          {
            "name": "currency",
            "type": "string"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    }
  ]
};
