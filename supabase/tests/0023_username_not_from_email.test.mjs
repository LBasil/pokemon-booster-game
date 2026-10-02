// 0023: a new account without a username is never named after its email
import { addUsers, freshDb, helpers } from './harness.mjs'

export default async function (check) {
  const db = await freshDb('0023')
  const { q, as, errorOf } = helpers(db)

  const [ash] = await addUsers(db, 'Ash')
  const noName = '00000000-0000-4000-8000-0000000000aa'
  const blank = '00000000-0000-4000-8000-0000000000bb'
  await q(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'jean.dupont@example.test', '{}')`, [noName])
  await q(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'marie.curie@example.test', $2)`, [blank, { username: '   ' }])

  const name = async (id) => (await q(`select username from profiles where id = $1`, [id]))[0]?.username
  check('a chosen username is kept', (await name(ash)) === 'Ash')
  const generated = await name(noName)
  check('no username: "Trainer-<digits>", not the email', /^Trainer-\d{4}$/.test(generated) && !generated.includes('jean'))
  const fromBlank = await name(blank)
  check('a blank username counts as none', /^Trainer-\d{4}$/.test(fromBlank) && !fromBlank.includes('marie'))
  check('generated names stay unique', generated.toLowerCase() !== fromBlank.toLowerCase())

  await as(ash)
  check('handle_new_user is still not callable by players', (await errorOf(`select handle_new_user()`)) !== '')
}
