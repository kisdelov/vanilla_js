import express from 'express';
import bcrypt from 'bcrypt';
import { format } from 'date-fns';
import { zonedTimeToUtc } from 'date-fns-tz/esm';

import { extend, flatMap, go, hi, isEmpty, log, map, reject, string, tap } from 'fxjs';
import {
    ASSOCIATE,
    ASSOCIATE1,
    COLUMN,
    EQ,
    IN,
    QUERY,
    QUERY1,
    SET,
    SQL,
    TB,
} from '../db/db_connect.js';
import { validCheck } from '../util/valid.js';
import Query from '../queries/query_v1.js';
import Push from '../util/push.js';

const USER_COLUMNS = ['name', 'email', 'password'];

const router = express.Router();

router.get('/todo/list/', async (req, res) => {
    const date = req.query?.date ? new Date(req.query.date) : new Date();
    const tz = req.headers.timezone;
    const now = format(zonedTimeToUtc(date, tz), 'yyyy-MM-dd');
    const user_id = req.query?.id || req.session.user.id;
    console.time('sql');

    const [user, my_follwings] = await Promise.all([
        Query.getById('users', user_id),
        QUERY`select * from followings where user_id = ${req.session.user.id}`,
    ]);

    go(
        ASSOCIATE`
            todos ${{
                hook: (todos) =>
                    go(
                        todos,
                        map((todo) =>
                            extend(
                                {
                                    my_todo: Number(todo.user_id) === req.session.user.id,
                                    comment_count: todo._.comments.length,
                                    like_count: todo._.likes.length - todo._.limit_likes.length,
                                    like_3: todo._.limit_likes,
                                    like: !!todo._.likes.find(
                                        (like) => Number(like.user_id) === req.session.user.id,
                                    ),
                                },
                                todo,
                            ),
                        ),
                    ),
                column: COLUMN(
                    'checked',
                    'content',
                    'date',
                    'id',
                    'modified_date',
                    'reg_date',
                    'user_id',
                ),
                query: SQL`where ${EQ({
                    user_id: user.id,
                    date: now,
                })} and archived_date is null order by id desc`,
            }}
                < comments ${{
                    column: COLUMN('id', 'user_id'),
                    query: SQL`where deleted_date is null`,
                }}
                p < likes ${{
                    column: COLUMN('user_id'),
                    query: SQL`where cancel_date is null`,
                }}
                p < limit_likes ${{
                    hook: (likes) => flatMap((like) => like._.user, likes),
                    key: 'attached_id',
                    poly_type: { attached_type: 'todos' },
                    table: 'likes',
                    query: SQL`where cancel_date is null`,
                    row_number: 3,
                    //     and ${IN(
                    //         'user_id',
                    //         flatMap(
                    //             (following) => following.following_id,
                    //             [...my_follwings, { following_id: req.session.user.id }],
                    //     ),
                    //     )}
                }}
                    - user ${{
                        column: COLUMN('name'),
                    }}
        `,
        (todos) =>
            res.json({
                code: '0001',
                result: todos,
                message: '???????????? ?????????????????????.',
            }),
    );
    console.timeEnd('sql');
});

router.get('/user/list', (req, res) =>
    isEmpty(req.query)
        ? res.status(400).json({ code: 'E001', message: '????????? ????????? ?????? ????????????.' })
        : go(
              req.query,
              validCheck(['people']),
              (valid_data) => ASSOCIATE`
                    users ${{
                        column: COLUMN('id', 'name', 'email'),
                        query: SQL`WHERE name LIKE ${'%' + valid_data.people + '%'} OR email LIKE ${
                            '%' + valid_data.people + '%'
                        }`,
                    }}
                `,
              Query.success(res, '?????????????????????.'),
          ).catch(Query.error(res)),
);

router.get('/user', (req, res) =>
    isEmpty(req.query)
        ? res.status(400).json({ code: 'E001', message: '????????? ????????? ?????? ????????????.' })
        : go(
              req.query,
              validCheck(['id', 'date']),
              (valid_data) => ASSOCIATE`
                    users ${{
                        column: COLUMN('id', 'name'),
                        query: SQL`WHERE ${EQ({ id: valid_data.id })}`,
                    }}
                        < todos ${{
                            query: SQL`WHERE ${EQ({
                                date: format(
                                    zonedTimeToUtc(valid_data.date, req.headers.timezone),
                                    'yyyy-MM-dd',
                                ),
                            })} AND archived_date IS NULL`,
                        }}
                `,
              Query.success(res, '?????????????????????.'),
          ).catch(Query.error(res)),
);

router.get('/user/:id/following', (req, res) =>
    isEmpty(req.params)
        ? res.status(400).json({ code: 'E001', message: '????????? ????????? ?????? ????????????.' })
        : go(
              req.params.id,
              async (id) => {
                  const cursor = Number(req.query.cursor || 0);
                  const following_count = await QUERY1`select count(*) from followings where ${EQ({
                      user_id: id,
                  })}`;

                  const followings = await ASSOCIATE`
                        followings ${SQL`where ${EQ({ user_id: id })} ${
                            cursor === 0 ? SQL`` : SQL`and id < ${cursor}`
                        } order by id desc limit 10`}
                            - user ${{
                                left_key: 'following_id',
                                column: COLUMN('id', 'name', 'email'),
                            }}
                  `;

                  const following_users = flatMap((following) => following._.user, followings);

                  return {
                      my_page: Number(id) === req.session.user.id,
                      followings: following_users,
                      following_count: following_count.count,
                      last_page: following_users.length !== 10,
                  };
              },
              Query.success(res, '???????????? ?????????????????????.'),
          ).catch(Query.error(res)),
);

router.get('/user/:id/follower', (req, res) =>
    isEmpty(req.params)
        ? res.status(400).json({ code: 'E001', message: '????????? ????????? ?????? ????????????.' })
        : go(
              req.params.id,
              async (id) => {
                  const cursor = Number(req.query.cursor || 0);
                  const follower_count = await QUERY1`select count(*) from followers where ${EQ({
                      user_id: id,
                  })}`;

                  const followers = await ASSOCIATE`
                        followers ${SQL`where ${EQ({ user_id: id })} ${
                            cursor === 0 ? SQL`` : SQL`and id < ${cursor}`
                        } order by id desc limit 10`}
                            - user ${{
                                left_key: 'follower_id',
                                column: COLUMN('id', 'name', 'email'),
                            }}
                  `;

                  const follower_users = flatMap((follower) => follower._.user, followers);

                  return {
                      my_page: Number(id) === req.session.user.id,
                      followers: follower_users,
                      follower_count: follower_count.count,
                      last_page: follower_users.length !== 10,
                  };
              },
              Query.success(res, '???????????? ?????????????????????.'),
          ).catch(Query.error(res)),
);

router.post('/user/:id/follow', (req, res) =>
    isEmpty(req.params)
        ? res.status(400).json({ code: 'E001', message: '????????? ????????? ?????? ????????????.' })
        : go(
              req.params.id,
              async (id) => {
                  await Query.insert('followings', {
                      user_id: req.session.user.id,
                      following_id: id,
                  });
                  await Query.insert('followers', {
                      user_id: id,
                      follower_id: req.session.user.id,
                  });

                  Push.sendNotification(
                      {
                          title: `${req.session.user.name}????????? ?????????????????????.`,
                          body: '',
                          tag: `follow_${req.session.user.id}`,
                          data: {
                              link: `/todo/page?id=${req.session.user.id}`,
                          },
                      },
                      id,
                  );

                  const following_count = await QUERY1`
                        SELECT COUNT(*) FROM followings 
                        WHERE user_id = ${req.query.my_count ? req.session.user.id : id}
                        `;

                  const follower_count = await QUERY1`
                        SELECT COUNT(*) FROM followers 
                        WHERE user_id = ${req.query.my_count ? req.session.user.id : id}
                        `;

                  return {
                      following_count: following_count.count,
                      follower_count: follower_count.count,
                  };
              },
              Query.success(res, '????????????????????????.'),
          ).catch(Query.error(res)),
);

router.delete('/user/:id/follow', (req, res) =>
    isEmpty(req.params)
        ? res.status(400).json({ code: 'E001', message: '????????? ????????? ?????? ????????????.' })
        : go(
              req.params.id,
              async (id) => {
                  await Query.delete('followings', {
                      user_id: req.session.user.id,
                      following_id: id,
                  });
                  await Query.delete('followers', {
                      user_id: id,
                      follower_id: req.session.user.id,
                  });

                  const following_count = await QUERY1`
                        SELECT COUNT(*) FROM followings 
                        WHERE user_id = ${req.query.my_count ? req.session.user.id : id}
                        `;

                  const follower_count = await QUERY1`
                        SELECT COUNT(*) FROM followers 
                        WHERE user_id = ${req.query.my_count ? req.session.user.id : id}
                        `;

                  return {
                      following_count: following_count.count,
                      follower_count: follower_count.count,
                  };
              },
              Query.success(res, '???????????? ?????????????????????.'),
          ).catch(Query.error(res)),
);

router.delete('/user/:id/follow/cancel', (req, res) =>
    isEmpty(req.params)
        ? res.status(400).json({ code: 'E001', message: '????????? ????????? ?????? ????????????.' })
        : go(
              req.params.id,
              async (id) => {
                  await Query.delete('followings', {
                      user_id: id,
                      following_id: req.session.user.id,
                  });
                  await Query.delete('followers', {
                      user_id: req.session.user.id,
                      follower_id: id,
                  });

                  const following_count = await QUERY1`
                        SELECT COUNT(*) FROM followings 
                        WHERE user_id = ${req.session.user.id}
                        `;

                  const follower_count = await QUERY1`
                        SELECT COUNT(*) FROM followers 
                        WHERE user_id = ${req.session.user.id}
                        `;

                  return {
                      following_count: following_count.count,
                      follower_count: follower_count.count,
                  };
              },
              Query.success(res, '???????????? ?????????????????????.'),
          ).catch(Query.error(res)),
);

router.post('/todo', (req, res) =>
    go(
        req.body,
        validCheck(['content', 'date']),
        (valid_data) =>
            Query.insert('todos')({
                ...valid_data,
                user_id: req.session.user.id,
            }),
        tap(async (todo) => {
            const me = await ASSOCIATE1`
                users ${SQL`where ${EQ({ id: todo.user_id })}`} 
                    < followers ${{
                        hook: (followers) => map((follower) => follower.follower_id, followers),
                    }}
            `;

            Push.sendNotification(
                {
                    title: `${me.name}????????? TODO??? ??????????????????.`,
                    body: `${todo.content} / ${format(
                        new Date(todo.date),
                        'yyyy??? MM??? dd??? ??????',
                    )}`,
                    tag: `following_todo_${todo.id}`,
                    data: {
                        action: 'toTodo',
                        payload: todo,
                        link: `/todo?id=${todo.user_id}&date=${format(
                            new Date(todo.date),
                            'yyyy-MM-dd',
                        )}`,
                    },
                },
                me._.followers,
            );
        }),
        Query.success(res, '????????? ?????????????????????.'),
    ).catch(Query.error(res)),
);

router.get('/todo/:id', (req, res) =>
    isEmpty(req.params)
        ? res.status(400).json({ code: 'E001', message: '????????? ????????? ?????? ????????????.' })
        : go(req.params.id, Query.getById('todos'), Query.success(res, '?????????????????????.')).catch(
              Query.error(res),
          ),
);

router.patch('/todo/:id', (req, res) =>
    isEmpty(req.params)
        ? res.status(400).json({ code: 'E001', message: '????????? ????????? ?????? ????????????.' })
        : go(
              req.params.id,
              Query.update('todos', req.body),
              Query.success(res, '???????????????????????????.'),
          ).catch(Query.error(res)),
);

router.post('/todo/:id/like', (req, res) =>
    isEmpty(req.params)
        ? res.status(400).json({ code: 'E001', message: '????????? ????????? ?????? ????????????.' })
        : go(
              Query.get('likes', {
                  attached_type: 'todos',
                  attached_id: req.params.id,
                  user_id: req.session.user.id,
              }),
              (like) =>
                  !like
                      ? Query.insert('likes', {
                            attached_id: req.params.id,
                            attached_type: 'todos',
                            user_id: req.session.user.id,
                        })
                      : Query.updateWhere(
                            'likes',
                            {
                                cancel_date: like.cancel_date
                                    ? null
                                    : zonedTimeToUtc(new Date(), 'Asia/Seoul'),
                            },
                            {
                                attached_id: req.params.id,
                                attached_type: 'todos',
                                user_id: req.session.user.id,
                            },
                        ),
              async (like) => {
                  if (!like.cancel_date) {
                      const todo = await Query.getById('todos', like.attached_id);
                      Push.sendNotification(
                          {
                              title: `"${todo.content}" TODO ?????????`,
                              body: `${req.session.user.name}????????? ????????? TODO??? ???????????? ???????????????.`,
                              tag: `like_to_todo_${like.todo_id}`,
                              data: {
                                  action: 'toTodo',
                                  payload: todo,
                              },
                          },
                          go(
                              [todo.user_id],
                              reject((id) => Number(id) === Number(req.session.user.id)),
                          ),
                      );
                  }

                  const todo = await ASSOCIATE1`
                      todos ${{
                          hook: (todos) =>
                              map(
                                  (_todo) => ({
                                      like_count: _todo._.likes.length - _todo._.limit_likes.length,
                                      like_3: _todo._.limit_likes,
                                      like: !!_todo._.likes.find(
                                          (like) => Number(like.user_id) === req.session.user.id,
                                      ),
                                  }),
                                  todos,
                              ),
                          query: SQL`where ${EQ({
                              id: like.attached_id,
                          })} `,
                      }}
                          p < likes ${{
                              column: COLUMN('user_id'),
                              query: SQL`where cancel_date is null`,
                          }}
                          p < limit_likes ${{
                              hook: (likes) => flatMap((like) => like._.user, likes),
                              key: 'attached_id',
                              poly_type: { attached_type: 'todos' },
                              table: 'likes',
                              query: SQL`where cancel_date is null`,
                              row_number: 3,
                          }}
                              - user ${{
                                  column: COLUMN('name'),
                              }}
                    `;

                  return {
                      ...like,
                      ...todo,
                  };
              },
              Query.success(res, '???????????????????????????.'),
          ).catch(Query.error(res)),
);

router.post('/todo/comment/:id/like', (req, res) =>
    isEmpty(req.params)
        ? res.status(400).json({ code: 'E001', message: '????????? ????????? ?????? ????????????.' })
        : go(
              Query.get('likes', {
                  attached_type: 'comments',
                  attached_id: req.params.id,
                  user_id: req.session.user.id,
              }),
              (like) =>
                  !like
                      ? Query.insert('likes', {
                            attached_id: req.params.id,
                            attached_type: 'comments',
                            user_id: req.session.user.id,
                        })
                      : Query.updateWhere(
                            'likes',
                            {
                                cancel_date: like.cancel_date
                                    ? null
                                    : zonedTimeToUtc(new Date(), 'Asia/Seoul'),
                            },
                            {
                                attached_id: req.params.id,
                                attached_type: 'comments',
                                user_id: req.session.user.id,
                            },
                        ),
              async (like) => {
                  if (!like.cancel_date) {
                      const comment = await Query.getById('comments', like.attached_id);
                      const todo = await Query.getById('todos', comment.todo_id);
                      Push.sendNotification(
                          {
                              title: `${req.session.user.name}?????? ?????????`,
                              body: `"${comment.content}" ????????? ???????????? ???????????????.`,
                              tag: `comment_${comment.id}`,
                              data: {
                                  action: 'toComment',
                                  payload: comment,
                                  link: `/todo?id=${todo.user_id}&date=${format(
                                      new Date(todo.date),
                                      'yyyy-MM-dd',
                                  )}`,
                              },
                          },
                          go(
                              [comment.user_id],
                              reject((id) => Number(id) === Number(req.session.user.id)),
                          ),
                      );
                  }

                  const like_count = await QUERY1` 
                            SELECT COUNT(user_id) AS like_count FROM likes 
                            WHERE attached_id = ${req.params.id} 
                            AND attached_type = 'comments' 
                            AND cancel_date IS NULL`;

                  return {
                      ...like,
                      ...like_count,
                  };
              },
              Query.success(res, '???????????????????????????.'),
          ).catch(Query.error(res)),
);

router.delete('/todo/comment/reply/:id', async (req, res) =>
    isEmpty(req.params)
        ? res.status(400).json({ code: 'E001', message: '????????? ????????? ?????? ????????????.' })
        : go(
              req.params.id,
              tap(() => console.time('??? ????????????')),
              Query.update('replys')({
                  deleted_date: zonedTimeToUtc(new Date(), 'Asia/Seoul'),
              }),
              tap(
                  (reply) =>
                      QUERY`update comments set reply_count = reply_count - 1 where id = ${reply.comment_id}`,
              ),
              tap(() => console.timeEnd('?????? ????????????')),
              Query.success(res, '?????? ?????? ?????????????????????.'),
          ).catch(Query.error(res)),
);

router.patch('/todo/comment/reply/:id', async (req, res) =>
    isEmpty(req.params)
        ? res.status(400).json({ code: 'E001', message: '????????? ????????? ?????? ????????????.' })
        : go(
              req.body,
              validCheck(['comment']),
              tap(() => console.time('?????? ????????????')),
              (valid_data) =>
                  Query.update('replys')({
                      ...valid_data,
                      modified_date: zonedTimeToUtc(new Date(), 'Asia/Seoul'),
                  })(req.params.id),
              async (updated_reply) => {
                  const reply_extend_user = await go(
                      Query.getByIdColumns('users', ['name'], updated_reply.user_id),
                      extend(updated_reply),
                  );

                  const reply_count = await QUERY1`
                            SELECT
                                COUNT(*)
                            FROM replys
                            WHERE
                                replys.comment_id = ${req.params.id}
                                AND replys.deleted_date IS NULL
                    `.catch(Query.error(res));

                  return { reply: reply_extend_user, reply_count: Number(reply_count.count) };
              },
              tap(() => console.timeEnd('?????? ????????????')),
              Query.success(res, '?????? ????????? ?????????????????????.'),
          ).catch(Query.error(res)),
);

router.post('/todo/comment/:id/reply', async (req, res) =>
    isEmpty(req.params)
        ? res.status(400).json({ code: 'E001', message: '????????? ????????? ?????? ????????????.' })
        : go(
              req.body,
              validCheck(['comment']),
              tap(() => console.time('?????? ????????????')),
              (valid_data) =>
                  Query.insert('replys')({
                      ...valid_data,
                      comment_id: req.params.id,
                      user_id: req.session.user.id,
                  }),
              tap(
                  (reply) =>
                      QUERY`update comments set reply_count = reply_count + 1 where id = ${reply.comment_id}`,
              ),
              async (inserted_reply) => {
                  const reply_user = await Query.getByIdColumns(
                      'users',
                      ['name as user_name'],
                      inserted_reply.user_id,
                  );
                  const reply_extend_user = extend(reply_user, inserted_reply, {
                      my_reply: Number(inserted_reply.user_id) === req.session.user.id,
                  });
                  const reply_count = await QUERY1`
                            SELECT
                                reply_count
                            FROM comments
                            WHERE
                                id = ${req.params.id}
                    `.catch(Query.error(res));

                  const comment = await Query.getById('comments', inserted_reply.comment_id);
                  const todo = await Query.getById('todos', comment.todo_id);

                  Push.sendNotification(
                      {
                          title: `${req.session.user.name}????????? ????????? ???????????????.`,
                          body: `${inserted_reply.comment}`,
                          tag: `reply_${inserted_reply.id}`,
                          data: {
                              action: 'toReply',
                              payload: comment,
                              link: `/todo?id=${todo.user_id}&date=${format(
                                  new Date(todo.date),
                                  'yyyy-MM-dd',
                              )}`,
                          },
                      },
                      go(
                          [todo.user_id, comment.user_id],
                          reject((id) => Number(id) === Number(req.session.user.id)),
                      ),
                  );

                  return { reply: reply_extend_user, reply_count: Number(reply_count.reply_count) };
              },
              tap(() => console.timeEnd('?????? ????????????')),
              Query.success(res, '?????? ????????? ?????????????????????.'),
          ).catch(Query.error(res)),
);

router.get('/todo/comment/:id/reply', async (req, res) => {
    if (isEmpty(req.params))
        return res.status(400).json({
            code: 'E001',
            message: '????????? ????????? ?????? ????????????.',
        });

    const cursor = Number(req.query.cursor || 0);

    console.time('?????? ???????????? ????????????');

    const reply_count = await QUERY1`
        SELECT
            COUNT(*)
        FROM replys
        WHERE
            replys.comment_id = ${req.params.id}
            AND replys.deleted_date IS NULL
    `.catch(Query.error(res));

    if (!reply_count)
        return res.status(400).json({
            code: 'E001',
            message: '????????? ????????? ?????? ????????????.',
        });

    const replys = await ASSOCIATE`
        replys ${{
            hook: (_replys) =>
                go(
                    _replys,
                    map((reply) =>
                        extend(
                            {
                                my_reply: Number(reply.user_id) === req.session.user.id,
                                user_name: reply._.user.name,
                            },
                            reply,
                        ),
                    ),
                ),
            query: SQL`where ${EQ({
                comment_id: req.params.id,
            })} and deleted_date is null ${
                cursor === 0 ? SQL`` : SQL`and id > ${cursor}`
            } order by id asc limit 10`,
        }}
            - user
    `;

    if (!replys)
        return res.status(400).json({
            code: 'E001',
            message: '????????? ????????? ?????? ????????????.',
        });

    console.timeEnd('?????? ???????????? ????????????');

    return Query.success(
        res,
        '?????????????????????.',
    )({
        replys,
        reply_count: Number(reply_count.count),
        last_page: replys.length !== 10,
    });
});

router.post('/todo/:id/comment', async (req, res) =>
    isEmpty(req.params)
        ? res.status(400).json({ code: 'E001', message: '????????? ????????? ?????? ????????????.' })
        : go(
              req.body,
              validCheck(['comment']),
              tap(() => console.time('????????? ????????????')),
              (valid_data) =>
                  Query.insert('comments')({
                      ...valid_data,
                      todo_id: req.params.id,
                      user_id: req.session.user.id,
                  }),
              async (inserted_comment) => {
                  const comment_count = await QUERY1`
                            SELECT
                                COUNT(*)
                            FROM comments
                            WHERE
                                comments.todo_id = ${req.params.id}
                                AND comments.deleted_date IS NULL
                    `.catch(Query.error(res));

                  const comment = await ASSOCIATE1`
                        comments ${{
                            hook: (comments) =>
                                go(
                                    comments,
                                    map((_comment) =>
                                        extend(
                                            {
                                                my_comment:
                                                    Number(_comment._.user.id) ===
                                                    req.session.user.id,
                                                user_name: _comment._.user.name,
                                                like_count: _comment._.likes.length,
                                                like: !!_comment._.likes.find(
                                                    (like) =>
                                                        Number(like.user_id) ===
                                                        req.session.user.id,
                                                ),
                                            },
                                            _comment,
                                        ),
                                    ),
                                ),
                            column: COLUMN(
                                'id',
                                'reg_date',
                                'modified_date',
                                'comment',
                                'user_id',
                                'reply_count',
                            ),
                            query: SQL`where ${EQ({
                                id: inserted_comment.id,
                            })} and deleted_date is null`,
                        }}
                            p < likes ${{
                                column: COLUMN('user_id'),
                                query: SQL`where cancel_date is null`,
                            }}
                            - user ${{
                                column: COLUMN('id', 'name'),
                            }}
                            < replys ${{
                                hook: (replys) =>
                                    go(
                                        replys,
                                        map((reply) =>
                                            extend(
                                                {
                                                    user_name: reply._.user.name,
                                                    my_reply:
                                                        reply._.user.id === req.session.user.id,
                                                },
                                                reply,
                                            ),
                                        ),
                                    ),
                                column: COLUMN(
                                    'id',
                                    'reg_date',
                                    'modified_date',
                                    'comment',
                                    'user_id',
                                ),
                                query: SQL`where deleted_date is null`,
                                row_number: [3, SQL`id asc`],
                            }}
                                - user ${{
                                    column: COLUMN('id', 'name'),
                                }}
                  `;

                  const todo = await Query.getById('todos', req.params.id);

                  Push.sendNotification(
                      {
                          title: `${req.session.user.name}????????? "${todo.content}" TODO??? ????????? ???????????????.`,
                          body: `${inserted_comment.comment}`,
                          tag: `comment_${inserted_comment.id}`,
                          data: {
                              action: 'toComment',
                              payload: inserted_comment,
                              link: `/todo?id=${todo.user_id}&date=${format(
                                  new Date(todo.date),
                                  'yyyy-MM-dd',
                              )}`,
                          },
                      },
                      go(
                          [todo.user_id],
                          reject((id) => Number(id) === Number(req.session.user.id)),
                      ),
                  );

                  return { comment, comment_count: Number(comment_count.count) };
              },
              tap(() => console.timeEnd('????????? ????????????')),
              Query.success(res, '?????? ????????? ?????????????????????.'),
          ).catch(Query.error(res)),
);

router.get('/todo/comment/:id', async (req, res) =>
    isEmpty(req.params)
        ? res.status(400).json({ code: 'E001', message: '????????? ????????? ?????? ????????????.' })
        : go(
              req.params.id,
              tap(() => console.time('????????? ????????????')),
              (id) => ASSOCIATE1`
                    comments ${{
                        hook: (comments) =>
                            go(
                                comments,
                                map((_comment) =>
                                    extend(
                                        {
                                            my_comment:
                                                Number(_comment._.user.id) === req.session.user.id,
                                            user_name: _comment._.user.name,
                                            like_count: _comment._.likes.length,
                                            like: !!_comment._.likes.find(
                                                (like) =>
                                                    Number(like.user_id) === req.session.user.id,
                                            ),
                                        },
                                        _comment,
                                    ),
                                ),
                            ),
                        column: COLUMN(
                            'id',
                            'reg_date',
                            'modified_date',
                            'comment',
                            'user_id',
                            'reply_count',
                        ),
                        query: SQL`where ${EQ({ id })} and deleted_date is null`,
                    }}
                        p < likes ${{
                            column: COLUMN('user_id'),
                            query: SQL`where cancel_date is null`,
                        }}
                        - user ${{
                            column: COLUMN('id', 'name'),
                        }}
                        < replys ${{
                            hook: (replys) =>
                                go(
                                    replys,
                                    map((reply) =>
                                        extend(
                                            {
                                                user_name: reply._.user.name,
                                                my_reply: reply._.user.id === req.session.user.id,
                                            },
                                            reply,
                                        ),
                                    ),
                                ),
                            column: COLUMN('id', 'reg_date', 'modified_date', 'comment', 'user_id'),
                            query: SQL`where deleted_date is null`,
                            row_number: [3, SQL`id asc`],
                        }}
                            - user ${{
                                column: COLUMN('id', 'name'),
                            }}
                `,
              tap(() => console.timeEnd('????????? ????????????')),
              Query.success(res, '????????? ?????????????????????.'),
          ).catch(Query.error(res)),
);

router.delete('/todo/comment/:id', async (req, res) =>
    isEmpty(req.params)
        ? res.status(400).json({ code: 'E001', message: '????????? ????????? ?????? ????????????.' })
        : go(
              req.params.id,
              tap(() => console.time('????????? ????????????')),
              Query.update('comments')({
                  deleted_date: zonedTimeToUtc(new Date(), 'Asia/Seoul'),
              }),
              async (updated_comment) => {
                  const comment_count = await QUERY1`
                            SELECT
                                COUNT(*)
                            FROM comments
                            WHERE
                                comments.todo_id = ${updated_comment.todo_id}
                                AND comments.deleted_date IS NULL
                    `;

                  const comment = await QUERY1`
                            SELECT 
                                id,
                                todo_id
                            FROM comments
                            WHERE comments.id = ${updated_comment.id}
                    `;

                  return { comment, comment_count: Number(comment_count.count) };
              },
              tap(() => console.timeEnd('????????? ????????????')),
              Query.success(res, '?????? ?????? ?????????????????????.'),
          ).catch(Query.error(res)),
);

router.patch('/todo/comment/:id', async (req, res) =>
    isEmpty(req.params)
        ? res.status(400).json({ code: 'E001', message: '????????? ????????? ?????? ????????????.' })
        : go(
              req.body,
              validCheck(['comment']),
              tap(() => console.time('????????? ????????????')),
              (valid_data) =>
                  Query.update('comments')({
                      ...valid_data,
                      modified_date: zonedTimeToUtc(new Date(), 'Asia/Seoul'),
                  })(req.params.id),
              async (updated_comment) => {
                  const comment_count = await QUERY1`
                            SELECT
                                COUNT(*)
                            FROM comments
                            WHERE
                                comments.todo_id = ${req.params.id}
                                AND comments.deleted_date IS NULL
                    `;

                  const comment = await ASSOCIATE1`
                            comments ${{
                                hook: (comments) =>
                                    go(
                                        comments,
                                        map((_comment) =>
                                            extend(
                                                {
                                                    my_comment:
                                                        Number(_comment._.user.id) ===
                                                        req.session.user.id,
                                                    user_name: _comment._.user.name,
                                                    like_count: _comment._.likes.length,
                                                    like: !!_comment._.likes.find(
                                                        (like) =>
                                                            Number(like.user_id) ===
                                                            req.session.user.id,
                                                    ),
                                                },
                                                _comment,
                                            ),
                                        ),
                                    ),
                                column: COLUMN(
                                    'id',
                                    'reg_date',
                                    'modified_date',
                                    'comment',
                                    'user_id',
                                    'reply_count',
                                ),
                                query: SQL`where ${EQ({
                                    id: updated_comment.id,
                                })} and deleted_date is null`,
                            }}
                                p < likes ${{
                                    column: COLUMN('user_id'),
                                    query: SQL`where cancel_date is null`,
                                }}
                                - user ${{
                                    column: COLUMN('id', 'name'),
                                }}
                                < replys ${{
                                    hook: (replys) =>
                                        go(
                                            replys,
                                            map((reply) =>
                                                extend(
                                                    {
                                                        user_name: reply._.user.name,
                                                        my_reply:
                                                            reply._.user.id === req.session.user.id,
                                                    },
                                                    reply,
                                                ),
                                            ),
                                        ),
                                    column: COLUMN(
                                        'id',
                                        'reg_date',
                                        'modified_date',
                                        'comment',
                                        'user_id',
                                    ),
                                    query: SQL`where deleted_date is null`,
                                    row_number: [3, SQL`id asc`],
                                }}
                                    - user ${{
                                        column: COLUMN('id', 'name'),
                                    }}
                `;

                  return { comment, comment_count: Number(comment_count.count) };
              },
              tap(() => console.timeEnd('????????? ????????????')),
              Query.success(res, '?????? ????????? ?????????????????????.'),
          ).catch(Query.error(res)),
);

router.get('/todo/:id/comment', async (req, res) => {
    if (isEmpty(req.params))
        return res.status(400).json({
            code: 'E001',
            message: '????????? ????????? ?????? ????????????.',
        });

    const cursor = Number(req.query.cursor || 0);

    console.time('????????? ???????????? ????????????');
    const comment_count = await QUERY1`
        SELECT
            COUNT(*)
        FROM comments
        WHERE
            comments.todo_id = ${req.params.id}
            AND comments.deleted_date IS NULL
    `.catch(Query.error(res));

    if (!comment_count)
        return res.status(400).json({
            code: 'E001',
            message: '????????? ????????? ?????? ????????????.',
        });

    const comments = await ASSOCIATE`
        comments ${{
            hook: (comments) =>
                go(
                    comments,
                    map((_comment) =>
                        extend(
                            {
                                my_comment: Number(_comment._.user.id) === req.session.user.id,
                                user_name: _comment._.user.name,
                                like_count: _comment._.likes.length,
                                like: !!_comment._.likes.find(
                                    (like) => Number(like.user_id) === req.session.user.id,
                                ),
                            },
                            _comment,
                        ),
                    ),
                ),
            column: COLUMN('id', 'reg_date', 'modified_date', 'comment', 'user_id', 'reply_count'),
            query: SQL`where ${EQ({
                todo_id: req.params.id,
            })} and deleted_date is null ${
                cursor === 0 ? SQL`` : SQL`and id < ${cursor}`
            } order by id desc limit 10`,
        }}
            p < likes ${{
                column: COLUMN('user_id'),
                query: SQL`where cancel_date is null`,
            }}
            - user ${{
                column: COLUMN('id', 'name'),
            }}
            < replys ${{
                hook: (replys) =>
                    go(
                        replys,
                        map((reply) =>
                            extend(
                                {
                                    user_name: reply._.user.name,
                                    my_reply: reply._.user.id === req.session.user.id,
                                },
                                reply,
                            ),
                        ),
                    ),
                column: COLUMN('id', 'reg_date', 'modified_date', 'comment', 'user_id'),
                query: SQL`where deleted_date is null`,
                row_number: [3, SQL`id asc`],
            }}
                - user ${{
                    column: COLUMN('id', 'name'),
                }}
    `.catch(Query.error(res));

    console.timeEnd('????????? ???????????? ????????????');

    if (!comments)
        return res.status(400).json({
            code: 'E001',
            message: '????????? ????????? ?????? ????????????.',
        });

    return Query.success(
        res,
        '?????????????????????.',
    )({
        comments,
        comment_count: Number(comment_count.count),
        last_page: comments.length !== 10,
    });
});

router.post('/archive', (req, res) =>
    isEmpty(req.query)
        ? res.status(400).json({ code: 'E001', message: '????????? ????????? ?????? ????????????.' })
        : go(
              req.query.id,
              Query.update('todos', {
                  archived_date: zonedTimeToUtc(new Date(), 'Asia/Seoul'),
              }),
              (data) => ({
                  todo_id: data.id,
                  user_id: data.user_id,
              }),
              Query.insert('archive'),
              Query.success(res, '?????????????????????.'),
          ).catch(Query.error(res)),
);

router.post('/archive/return/:pk', (req, res) =>
    isEmpty(req.params)
        ? res.status(400).json({ code: 'E001', message: '????????? ????????? ?????? ????????????.' })
        : go(
              req.params.pk,
              Query.update('todos', { archived_date: null }),
              (todo) =>
                  QUERY1`DELETE FROM ${TB('archive')} WHERE ${EQ({
                      todo_id: todo.id,
                  })}`,
              Query.success(res, '?????????????????????.'),
          ).catch(Query.error(res)),
);

router.post('/archive/delete/:pk', (req, res) =>
    isEmpty(req.params)
        ? res.status(400).json({ code: 'E001', message: '????????? ????????? ?????? ????????????.' })
        : go(
              Query.updateWhere(
                  'archive',
                  { delete_date: zonedTimeToUtc(new Date(), 'Asia/Seoul') },
                  { todo_id: req.params.pk },
              ),
              Query.success(res, '?????????????????????.'),
          ).catch(Query.error(res)),
);

router.post('/archive/delete_all', (req, res) =>
    go(
        QUERY`UPDATE ${TB('archive')} ${SET({
            delete_date: zonedTimeToUtc(new Date(), 'Asia/Seoul'),
        })} WHERE ${EQ({
            user_id: req.session.user.id,
        })} AND delete_date IS NULL`,
        Query.success(res, '?????? ?????????????????????.'),
    ).catch(Query.error(res)),
);

router.post('/logout', (req, res) => {
    const user = { ...req.session.user };
    delete req.session.user;
    req.session.destroy();

    go(
        Query.updateWhere(
            'tokens',
            { expired_date: zonedTimeToUtc(new Date(), 'Asia/Seoul') },
            { user_id: user.id },
        ),
        Query.success(res, '??????????????? ?????????????????????.'),
    ).catch(Query.error(res));
});

router.post('/login', async function (req, res) {
    const valid_data = await go(req.body, validCheck(['email', 'password'])).catch(
        Query.error(res),
    );

    if (!valid_data) return;

    go(
        valid_data,
        ({ email }) =>
            Query.getColumns('users', ['id', 'name', 'email', 'password'], {
                email,
            }),
        tap(
            Query.emptyCheck({
                code: 'E002',
                message: '???????????? ????????? ????????????.',
            }),
        ),
        tap((user) =>
            Query.passwordCheck(
                {
                    code: 'E002',
                    message: '??????????????? ???????????? ????????????.',
                },
                valid_data.password,
                user.password,
            ),
        ),
        (user) => {
            delete user.password;
            req.session.user = user;
            Query.success(res, '????????? ???????????????.', user);
        },
    ).catch(Query.error(res));
});

router.post('/reg', (req, res) =>
    go(
        req.body,
        validCheck(USER_COLUMNS),
        tap(
            ({ name }) => Query.get('users', { name }),
            Query.duplicateCheck({
                code: 'E002',
                message: '????????? ???????????????.',
            }),
        ),
        tap(
            ({ email }) => Query.get('users', { email }),
            Query.duplicateCheck({
                code: 'E002',
                message: '???????????? ???????????????.',
            }),
        ),
        (valid_data) => {
            valid_data.password = bcrypt.hashSync(valid_data.password, 10);
            return valid_data;
        },
        Query.insert('users'),
        Query.success(res, '??????????????? ?????????????????????.'),
    ).catch(Query.error(res)),
);

export default router;
